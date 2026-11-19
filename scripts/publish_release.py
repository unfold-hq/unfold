import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

from extension_version import PAUSED as MARKETPLACE_PAUSED, extension_version
from release_floors import refuse_occupied
from release_registry import GITHUB_SOURCE, Registry, command, digest, request, require_same, verify_image, verify_keyless, verify_keyless_signature


ROOT = Path(__file__).resolve().parent.parent
HOME_REPOSITORY = 'unfold-hq/unfold'
HOME = f'https://api.github.com/repos/{HOME_REPOSITORY}'
HOME_REGISTRY = 'ghcr.io'
HOME_NAMESPACE = 'unfold-hq'
EXTENSION_MANIFEST = ROOT / 'apps/unfold/extensions/vscode/package.json'
OPEN_VSX_SCAN_DEADLINE = 1200
OPEN_VSX_POLL_INTERVAL = 30
MARKETPLACE_QUERY = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'
MARKETPLACE_VSIX = 'Microsoft.VisualStudio.Services.VSIXPackage'
MARKETPLACE_PRERELEASE = 'Microsoft.VisualStudio.Code.PreRelease'
MARKETPLACE_INCLUDE_VERSIONS_FILES_PROPERTIES = 0x1 | 0x2 | 0x10
MARKETPLACE_VALIDATION_DEADLINE = 1200
MARKETPLACE_POLL_INTERVAL = 30
RETIRED_PUBLISHERS = {
    'ploeg': 'Unfold no longer versions or publishes Ploeg: github.com/ploeg-hq/ploeg releases it from 0.1.0, and Unfold pins that source (system ADR-0019)',
}


def api(url, token, method='GET', data=None, missing=False):
    body, _ = request(url, method=method, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/json'}, data=json.dumps(data).encode() if data is not None else None, missing=missing)
    return json.loads(body) if body else None


def git(*args, env=None, input=None):
    return command('git', *args, env={**(env or os.environ), 'GIT_TERMINAL_PROMPT': '0'}, input=input)


def release_tag(application, version):
    if application in RETIRED_PUBLISHERS:
        raise ValueError(RETIRED_PUBLISHERS[application])
    if application != 'unfold' or not re.fullmatch(r'0\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.([1-9][0-9]*)', version):
        raise ValueError('Unfold publishes only Unfold, as 0.x.y-rc.N releases')
    return f'unfold-v{version}'


def publishable_tag(application, version):
    tag = release_tag(application, version)
    refuse_occupied(application, version)
    return tag


def extension_identity():
    manifest = json.loads(EXTENSION_MANIFEST.read_text(encoding='utf-8'))
    return manifest['publisher'], manifest['name']


def open_vsx_extension(version):
    namespace, name = extension_identity()
    version = extension_version(version)
    url = f'https://open-vsx.org/api/{namespace}/{name}/{version}'
    deadline = time.monotonic() + OPEN_VSX_SCAN_DEADLINE
    while True:
        extension = api(url, '', missing=True)
        if extension is not None:
            return extension
        if time.monotonic() >= deadline:
            raise RuntimeError(f'Open VSX still does not serve {namespace}.{name} {version} after {OPEN_VSX_SCAN_DEADLINE} seconds; check its publish scan at https://open-vsx.org/extension/{namespace}/{name}')
        print(f'Open VSX does not serve {namespace}.{name} {version} yet; it is still scanning the published VSIX', file=sys.stderr)
        time.sleep(OPEN_VSX_POLL_INTERVAL)


def marketplace_versions():
    query = {'filters': [{'criteria': [{'filterType': 7, 'value': '.'.join(extension_identity())}]}], 'flags': MARKETPLACE_INCLUDE_VERSIONS_FILES_PROPERTIES}
    body, _ = request(MARKETPLACE_QUERY, method='POST', data=json.dumps(query).encode(), headers={'Content-Type': 'application/json', 'Accept': 'application/json;api-version=7.2-preview.1'})
    extensions = json.loads(body)['results'][0]['extensions']
    return extensions[0]['versions'] if extensions else []


def marketplace_extension(version):
    namespace, name = extension_identity()
    wanted = extension_version(version)
    deadline = time.monotonic() + MARKETPLACE_VALIDATION_DEADLINE
    while True:
        listed = next((v for v in marketplace_versions() if v['version'] == wanted and not v.get('targetPlatform')), None)
        if listed is not None and listed.get('flags') == 'validated':
            return listed
        if time.monotonic() >= deadline:
            raise RuntimeError(f'The Visual Studio Marketplace still does not serve a validated {namespace}.{name} {wanted} for {version} after {MARKETPLACE_VALIDATION_DEADLINE} seconds; check https://marketplace.visualstudio.com/manage/publishers/{namespace}')
        print(f'The Visual Studio Marketplace does not serve a validated {namespace}.{name} {wanted} yet; it is still validating the published VSIX', file=sys.stderr)
        time.sleep(MARKETPLACE_POLL_INTERVAL)


def marketplace_download(listed):
    url = next(f['source'] for f in listed['files'] if f['assetType'] == MARKETPLACE_VSIX)
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise RuntimeError('Unexpected Marketplace download URL')
    return url


def marketplace_prerelease(listed):
    return any(p['key'] == MARKETPLACE_PRERELEASE and p['value'] == 'true' for p in listed.get('properties', []))


def fetch_asset(asset):
    url = asset['browser_download_url']
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != 'github.com':
        raise RuntimeError('Unexpected release asset host')
    data, _ = request(url)
    return data


def github_release(tag, token, repository=HOME):
    target = api(f'{repository}/releases/tags/{tag}', token, missing=True)
    if target is not None:
        return target
    drafts = [r for r in api(f'{repository}/releases?per_page=100', token) if r['draft'] and r['tag_name'] == tag]
    return drafts[0] if drafts else None


def fetch_github_asset(asset, token, draft, repository=HOME):
    if not draft:
        return fetch_asset(asset)
    if not asset['url'].startswith(repository + '/releases/assets/'):
        raise RuntimeError('Unexpected GitHub asset URL')
    data, _ = request(asset['url'], headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/octet-stream'})
    return data


def attach_github(release, name, content, token, repository=HOME):
    existing = next((a for a in release['assets'] if a['name'] == name), None)
    if existing:
        require_same(digest(fetch_github_asset(existing, token, release['draft'], repository)), digest(content), 'GitHub asset ' + name)
        return
    if not release['draft']:
        raise RuntimeError(f'GitHub release {release["tag_name"]} is already published without {name}; immutable releases take assets only while they are drafts')
    upload = release['upload_url'].split('{')[0]
    if urllib.parse.urlsplit(upload).netloc != 'uploads.github.com':
        raise RuntimeError('Unexpected GitHub upload host')
    request(upload + '?' + urllib.parse.urlencode({'name': name}), method='POST', data=content, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/octet-stream'})


def verify_marketplace(version, asset, release, token, evidence):
    listed = marketplace_extension(version)
    require_same(marketplace_prerelease(listed), listed['version'] != version, 'Marketplace pre-release flag')
    url = marketplace_download(listed)
    data, _ = request(url)
    require_same(digest(data), digest(fetch_github_asset(asset, token, release['draft'], HOME)), 'Marketplace VSIX')
    evidence['marketplace'] = {'id': '.'.join(extension_identity()), 'version': listed['version'], 'pre_release': marketplace_prerelease(listed), 'sha256': hashlib.sha256(data).hexdigest(), 'url': url}


def publish(application, version):
    tag = publishable_tag(application, version)
    revision = git('rev-parse', f'{tag}^{{commit}}')
    require_same(git('rev-parse', 'HEAD'), revision, 'publisher checkout')
    token = os.environ['GITHUB_TOKEN']
    release = github_release(tag, token, HOME)
    if release is None:
        raise RuntimeError(f'{HOME_REPOSITORY} has no release for {tag}; the release train files it as a draft')
    anonymous = Registry(HOME_REGISTRY)
    evidence = {'schema_version': 2, 'tag': tag, 'source': GITHUB_SOURCE, 'revision': revision, 'images': [], 'charts': []}
    for name in ['unfold', 'unfold-agent']:
        repository = f'{HOME_NAMESPACE}/{name}'
        reference = verify_image(anonymous, repository, version, revision, GITHUB_SOURCE)
        verify_keyless_signature(f'{HOME_REGISTRY}/{repository}@{reference}')
        evidence['images'].append({'name': name, 'reference': f'{HOME_REGISTRY}/{repository}@{reference}'})
    chart = f'{HOME_NAMESPACE}/charts/unfold'
    reference = digest(anonymous.manifest(chart, version))
    verify_keyless(f'{HOME_REGISTRY}/{chart}@{reference}')
    evidence['charts'].append({'name': 'unfold', 'reference': f'{HOME_REGISTRY}/{chart}@{reference}'})
    extension = open_vsx_extension(version)
    require_same(extension['version'], extension_version(version), 'Open VSX version')
    vsix = next((a for a in release['assets'] if a['name'] == f'unfold-{version}.vsix'), None)
    if vsix is None:
        raise RuntimeError(f'{tag} has no unfold-{version}.vsix; the extension job attaches it before Open VSX gets it')
    data, _ = request(extension['files']['download'])
    require_same(digest(data), digest(fetch_github_asset(vsix, token, release['draft'], HOME)), 'Open VSX VSIX')
    evidence['extension'] = {'id': '.'.join(extension_identity()), 'version': extension['version'], 'sha256': hashlib.sha256(data).hexdigest(), 'url': extension['files']['download']}
    if not MARKETPLACE_PAUSED:
        verify_marketplace(version, vsix, release, token, evidence)
    attach_github(release, f'release-artifacts-{application}.json', (json.dumps(evidence, indent=2) + '\n').encode(), token, HOME)
    if release['draft']:
        release = api(f'{HOME}/releases/{release["id"]}', token, 'PATCH', {'draft': False, 'make_latest': 'false'})
    print(release['html_url'])
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    publish(sys.argv[1], sys.argv[2])
