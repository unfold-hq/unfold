import base64
import hashlib
import http.client
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.get_method() not in ('GET', 'HEAD'):
            raise urllib.error.HTTPError(req.full_url, code, f'{req.get_method()} redirected to {newurl}; call the new address', headers, fp)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if urllib.parse.urlsplit(req.full_url).netloc != urllib.parse.urlsplit(newurl).netloc:
            redirected.remove_header('Authorization')
        return redirected


READ_ATTEMPTS = 3
COMMAND_TIMEOUT = 600
TRANSIENT_STATUS = {429, 500, 502, 503, 504}
TRANSIENT_ERRORS = (http.client.IncompleteRead, http.client.RemoteDisconnected, ConnectionError, TimeoutError, urllib.error.URLError)
GITHUB_SOURCE = 'https://github.com/unfold-hq/unfold'
GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'
GITHUB_SIGNER = r'^https://github\.com/unfold-hq/unfold/\.github/workflows/on_release_published\.yml@refs/tags/unfold-v0\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$'
KEYLESS_IDENTITY = ('--certificate-identity-regexp', GITHUB_SIGNER, '--certificate-oidc-issuer', GITHUB_ISSUER)


def request(url, method='GET', data=None, headers=None, missing=False):
    attempts = READ_ATTEMPTS if method in ('GET', 'HEAD') else 1
    for attempt in range(1, attempts + 1):
        try:
            return request_once(url, method, data, headers, missing)
        except urllib.error.HTTPError as error:
            if error.code not in TRANSIENT_STATUS or attempt == attempts:
                raise_http_error(url, method, error)
        except TRANSIENT_ERRORS:
            if attempt == attempts:
                raise
        time.sleep(2 ** attempt)


def request_once(url, method, data, headers, missing):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.build_opener(SafeRedirect).open(req, timeout=120) as response:
            return response.read(), response.headers
    except urllib.error.HTTPError as error:
        if missing and error.code == 404:
            return None, error.headers
        raise


def raise_http_error(url, method, error):
    detail = error.read(300).decode('utf-8', 'replace').strip() if error.fp else ''
    raise RuntimeError(f'{method} {urllib.parse.urlsplit(url).netloc} returned HTTP {error.code}' + (f': {detail}' if detail else '')) from None


def command(*args, env=None, input=None):
    env = {**(os.environ if env is None else env), 'GIT_TERMINAL_PROMPT': '0'}
    try:
        result = subprocess.run(args, env=env, input=input, stdin=None if input is not None else subprocess.DEVNULL, capture_output=True, text=True, timeout=COMMAND_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'{args[0]} {args[1]} did not finish within {COMMAND_TIMEOUT} seconds') from None
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed: {result.stderr[-2000:]}')
    return result.stdout.strip()


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def require_same(actual, expected, label):
    if actual != expected:
        raise RuntimeError(f'{label}: expected {expected}, got {actual}; existing versions are immutable')


class Registry:
    def __init__(self, host, user='', password=''):
        self.host = host
        self.basic = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode() if user else ''
        self.tokens = {}

    def headers(self, repository, actions='pull'):
        key = (repository, actions)
        if key in self.tokens:
            return self.tokens[key]
        url = f'https://{self.host}/v2/'
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=30):
                challenge = ''
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise RuntimeError(f'{self.host} registry probe returned {error.code}') from None
            challenge = error.headers.get('WWW-Authenticate', '')
        auth = self.basic
        if challenge.lower().startswith('bearer '):
            fields = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
            realm = urllib.parse.urlsplit(fields['realm'])
            allowed = {self.host, 'auth.docker.io'} if self.host == 'registry-1.docker.io' else {self.host}
            if realm.scheme != 'https' or realm.netloc not in allowed:
                raise RuntimeError(f'Untrusted authentication realm for {self.host}')
            query = urllib.parse.urlencode({'service': fields.get('service', self.host), 'scope': f'repository:{repository}:{actions}'})
            data, _ = request(fields['realm'] + '?' + query, headers={'Authorization': self.basic} if self.basic else {})
            result = json.loads(data)
            auth = 'Bearer ' + (result.get('token') or result['access_token'])
        self.tokens[key] = {'Authorization': auth} if auth else {}
        return self.tokens[key]

    def manifest(self, repository, reference, missing=False):
        accept = ', '.join(['application/vnd.oci.image.index.v1+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.docker.distribution.manifest.v2+json'])
        data, headers = request(f'https://{self.host}/v2/{repository}/manifests/{reference}', headers={**self.headers(repository), 'Accept': accept}, missing=missing)
        if data is not None:
            require_same(headers.get('Docker-Content-Digest', digest(data)), digest(data), 'registry content digest')
        return data

    def blob(self, repository, reference):
        data, _ = request(f'https://{self.host}/v2/{repository}/blobs/{reference}', headers=self.headers(repository))
        require_same(digest(data), reference, 'blob digest')
        return data


def verify_image(registry, repository, version, revision, source=GITHUB_SOURCE):
    raw = registry.manifest(repository, version)
    index = json.loads(raw)
    require_same(index.get('annotations', {}).get('org.opencontainers.image.source'), source, 'index source')
    platforms = set()
    for descriptor in index.get('manifests', []):
        platform = descriptor.get('platform', {})
        if platform.get('os') != 'linux' or platform.get('architecture') not in {'amd64', 'arm64'}:
            continue
        platforms.add(platform['architecture'])
        manifest = json.loads(registry.manifest(repository, descriptor['digest']))
        config = json.loads(registry.blob(repository, manifest['config']['digest']))
        labels = config['config'].get('Labels', {})
        for key, expected in [('version', version), ('revision', revision), ('source', source)]:
            require_same(labels.get('org.opencontainers.image.' + key), expected, f'{platform} {key}')
    require_same(platforms, {'amd64', 'arm64'}, 'image platforms')
    return digest(raw)


def verify_keyless(reference):
    command('cosign', 'verify', *KEYLESS_IDENTITY, reference)


def sign_keyless_once(reference):
    try:
        verify_keyless(reference)
        return False
    except RuntimeError:
        pass
    command('cosign', 'sign', '--yes', reference)
    verify_keyless(reference)
    return True


def verify_keyless_signature(reference):
    verify_keyless(reference)
    statements = command('cosign', 'verify-attestation', *KEYLESS_IDENTITY, '--type', 'cyclonedx', reference)
    if not statements:
        raise RuntimeError(f'Missing verified SBOM for {reference}')
