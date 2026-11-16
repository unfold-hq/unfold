import copy
import json
import re
import shutil
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

import publish_chart
import publish_release
import release_registry
from release_registry import GITHUB_SOURCE, SafeRedirect, digest, verify_image


class MemoryRegistry:
    def __init__(self, host='ghcr.io'):
        self.host = host
        self.manifests = {}
        self.blobs = {}

    def manifest(self, repository, reference, missing=False):
        if (repository, reference) not in self.manifests and not missing:
            raise RuntimeError('missing fixture manifest')
        return self.manifests.get((repository, reference))

    def blob(self, repository, reference):
        return self.blobs[reference]



def fixture():
    registry = MemoryRegistry()
    index = {'annotations': {'org.opencontainers.image.source': GITHUB_SOURCE}, 'manifests': []}
    for arch in ['amd64', 'arm64']:
        config = json.dumps({'config': {'Labels': {'org.opencontainers.image.source': GITHUB_SOURCE, 'org.opencontainers.image.version': '0.3.0-rc.8', 'org.opencontainers.image.revision': 'selected-sha'}}}).encode()
        manifest = json.dumps({'config': {'digest': digest(config)}}).encode()
        registry.blobs[digest(config)] = config
        registry.manifests['unfold-hq/unfold', digest(manifest)] = manifest
        index['manifests'].append({'platform': {'os': 'linux', 'architecture': arch}, 'digest': digest(manifest)})
    registry.manifests['unfold-hq/unfold', '0.3.0-rc.8'] = json.dumps(index).encode()
    return registry


class DistributionTests(unittest.TestCase):
    def test_accepts_only_supported_application_prereleases(self):
        self.assertEqual(publish_release.release_tag('unfold', '0.3.0-rc.8'), 'unfold-v0.3.0-rc.8')
        for application, version in [('other', '0.3.0-rc.8'), ('ploeg', '0.3.0-rc.8'), ('ploeg', '1.0.0-rc.1'), ('unfold', '0.3.0'), ('unfold', '0.3.0-beta.1'), ('unfold', '0.3.0-rc.0'), ('unfold', '0.03.0-rc.8'), ('unfold', '0.3.0-rc.8;echo bad')]:
            with self.assertRaises(ValueError):
                publish_release.release_tag(application, version)

    def test_every_image_platform_must_identify_the_unfold_release(self):
        source = fixture()
        verify_image(source, 'unfold-hq/unfold', '0.3.0-rc.8', 'selected-sha')
        with self.assertRaises(RuntimeError):
            verify_image(source, 'unfold-hq/unfold', '0.3.0-rc.8', 'another-sha')
        for mutation in ['source', 'platform']:
            changed = copy.deepcopy(source)
            index = json.loads(changed.manifests['unfold-hq/unfold', '0.3.0-rc.8'])
            if mutation == 'source':
                index['annotations']['org.opencontainers.image.source'] = 'https://github.com/webgrip/unfold'
            else:
                index['manifests'].pop()
            changed.manifests['unfold-hq/unfold', '0.3.0-rc.8'] = json.dumps(index).encode()
            with self.assertRaises(RuntimeError):
                verify_image(changed, 'unfold-hq/unfold', '0.3.0-rc.8', 'selected-sha')

    def test_the_publication_workflow_publishes_only_unfold(self):
        workflow = (Path(__file__).resolve().parent.parent / '.github/workflows/on_release_published.yml').read_text()
        self.assertEqual(re.findall(r'python3 scripts/publish_release\.py (\S+)', workflow), ['unfold'])
        self.assertEqual(re.findall(r'python3 scripts/publish_chart\.py (\S+)', workflow), ['unfold'])

    def test_a_release_asset_is_fetched_only_from_github(self):
        with patch.object(publish_release, 'request', lambda url, **k: (b'asset', {})):
            self.assertEqual(publish_release.fetch_asset({'browser_download_url': 'https://github.com/unfold-hq/unfold/releases/download/unfold-v0.4.0-rc.9/a.json'}), b'asset')
            for url in ['https://example.invalid/a.json', 'http://github.com/a.json']:
                with self.subTest(url=url), self.assertRaisesRegex(RuntimeError, 'Unexpected release asset host'):
                    publish_release.fetch_asset({'browser_download_url': url})

    def test_the_published_chart_names_unfold_as_its_source_and_home(self):
        root = Path(__file__).resolve().parent.parent
        metadata = release_registry.command('helm', 'show', 'chart', str(root / 'apps/unfold/ops/helm/unfold')).splitlines()
        self.assertIn('home: https://forgejo.webgrip.dev/webgrip/unfold', metadata)
        self.assertEqual(metadata[metadata.index('sources:') + 1], '- https://github.com/webgrip/unfold')

    def test_the_released_chart_defaults_every_unfold_image_to_its_pushed_digest(self):
        root = Path(__file__).resolve().parent.parent
        digests = {'unfold': 'sha256:' + 'a' * 64, 'unfold-agent': 'sha256:' + 'b' * 64}
        values = publish_chart.release_values((root / 'apps/unfold/ops/helm/unfold/values.yaml').read_text(), '0.4.0-rc.9', digests)
        self.assertIn('image:\n  repository: ghcr.io/unfold-hq/unfold\n  tag: "0.4.0-rc.9"\n  digest: "sha256:' + 'a' * 64 + '"\n', values)
        self.assertIn('\nworkspaceImage: ""\nworkspaceAgentImage:\n  repository: ghcr.io/unfold-hq/unfold-agent\n  tag: "0.4.0-rc.9"\n  digest: "sha256:' + 'b' * 64 + '"\n', values)
        with self.assertRaisesRegex(RuntimeError, 'one image block with an empty tag and digest'):
            publish_chart.release_values(values, '0.4.0-rc.9', digests)

    def test_a_consumer_moves_the_released_workspace_image_to_its_registry_and_keeps_the_stamped_version_and_digest(self):
        root = Path(__file__).resolve().parent.parent
        chart = root / 'apps/unfold/ops/helm/unfold'
        agent = 'sha256:' + 'b' * 64
        with tempfile.TemporaryDirectory() as directory:
            staged = Path(directory) / 'unfold'
            shutil.copytree(chart, staged)
            values = staged / 'values.yaml'
            values.write_text(publish_chart.release_values(values.read_text(), '0.4.0-rc.9', {'unfold': 'sha256:' + 'a' * 64, 'unfold-agent': agent}))
            self.assertIn(f'ghcr.io/unfold-hq/unfold-agent:0.4.0-rc.9@{agent}', publish_chart.rendered_images(str(staged)))
            mirrored = publish_chart.rendered_images(str(staged), 'workspaceAgentImage.repository=registry.example/mirror/unfold-agent')
            self.assertIn(f'registry.example/mirror/unfold-agent:0.4.0-rc.9@{agent}', mirrored)
            self.assertNotIn(f'ghcr.io/unfold-hq/unfold-agent:0.4.0-rc.9@{agent}', mirrored)
            overridden = publish_chart.rendered_images(str(staged), 'workspaceAgentImage.repository=registry.example/mirror/unfold-agent', 'workspaceImage=registry.example/agent:1.0.0@sha256:' + 'c' * 64)
            self.assertIn('registry.example/agent:1.0.0@sha256:' + 'c' * 64, overridden)
            self.assertFalse([image for image in overridden if 'unfold-agent' in image])

    def test_a_stale_committed_chart_version_is_packaged_at_the_release_version(self):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as directory:
            staged = Path(directory) / 'source' / 'unfold'
            shutil.copytree(root / 'apps/unfold/ops/helm/unfold', staged)
            chart = staged / 'Chart.yaml'
            chart.write_text(re.sub(r'^(version|appVersion): .*$', r'\g<1>: 0.0.1-rc.1', chart.read_text(), flags=re.M))
            committed = release_registry.command('helm', 'show', 'chart', str(staged))
            expected = publish_chart.release_metadata(committed, '0.4.0-rc.9')
            self.assertNotEqual(expected, committed)
            packaged = publish_chart.package_release_chart(staged, directory, '0.4.0-rc.9')
            self.assertEqual(packaged.name, 'unfold-0.4.0-rc.9.tgz')
            shown = release_registry.command('helm', 'show', 'chart', str(packaged))
            self.assertEqual(shown, expected)
            self.assertIn('version: 0.4.0-rc.9', shown.splitlines())
            self.assertIn('appVersion: 0.4.0-rc.9', shown.splitlines())
            self.assertNotIn('0.0.1-rc.1', shown)

    def test_chart_metadata_without_one_version_and_one_app_version_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'one version and one appVersion'):
            publish_chart.release_metadata('apiVersion: v2\nname: unfold\nversion: 0.4.0-rc.1\n', '0.4.0-rc.9')

    def test_the_chart_waits_for_the_pushed_digest_of_every_image(self):
        registry = MemoryRegistry()
        registry.manifests['unfold-hq/unfold', '0.4.0-rc.9'] = b'unfold-index'
        registry.manifests['unfold-hq/unfold-agent', '0.4.0-rc.9'] = b'agent-index'
        pushed = {'UNFOLD_IMAGE_DIGEST': digest(b'unfold-index'), 'UNFOLD_AGENT_IMAGE_DIGEST': digest(b'agent-index')}
        self.assertEqual(publish_chart.released_digests(registry, '0.4.0-rc.9', pushed), {'unfold': digest(b'unfold-index'), 'unfold-agent': digest(b'agent-index')})
        with self.assertRaisesRegex(RuntimeError, 'UNFOLD_AGENT_IMAGE_DIGEST must be the pushed digest'):
            publish_chart.released_digests(registry, '0.4.0-rc.9', {**pushed, 'UNFOLD_AGENT_IMAGE_DIGEST': ''})
        with self.assertRaisesRegex(RuntimeError, 'ghcr.io/unfold-hq/unfold:0.4.0-rc.9'):
            publish_chart.released_digests(registry, '0.4.0-rc.9', {**pushed, 'UNFOLD_IMAGE_DIGEST': 'sha256:' + 'c' * 64})

    def test_the_key_that_verifies_releases_from_before_the_move_is_one_pem_cosign_can_load(self):
        pem = (Path(__file__).resolve().parent.parent / 'ops/security/cosign.pub').read_text()
        self.assertEqual(pem.count('BEGIN PUBLIC KEY'), 1)

    def test_redirects_never_forward_credentials_to_another_host(self):
        request = urllib.request.Request('https://api.github.com/asset', headers={'Authorization': 'fixture'})
        redirected = SafeRedirect().redirect_request(request, None, 302, '', {}, 'https://storage.example.invalid/asset')
        self.assertFalse(redirected.has_header('Authorization'))
        redirected = SafeRedirect().redirect_request(request, None, 302, '', {}, 'https://api.github.com/other')
        self.assertEqual(redirected.get_header('Authorization'), 'fixture')

    def test_a_redirected_write_fails_instead_of_becoming_a_read(self):
        request = urllib.request.Request('https://api.github.com/repos/unfold-hq/old/releases/7/assets', data=b'evidence', method='POST')
        with self.assertRaises(urllib.error.HTTPError) as raised:
            SafeRedirect().redirect_request(request, None, 301, '', {}, 'https://api.github.com/repos/unfold-hq/unfold/releases/7/assets')
        self.assertEqual(raised.exception.code, 301)

    def test_a_command_never_waits_for_a_credential_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'prompt'
            script.write_text('#!/bin/sh\nprintf %s "$GIT_TERMINAL_PROMPT"\nread answer\nexit 0\n')
            script.chmod(0o755)
            self.assertEqual(release_registry.command(str(script), 'probe'), '0')
            with patch.object(release_registry, 'COMMAND_TIMEOUT', 0.2):
                with self.assertRaisesRegex(RuntimeError, 'did not finish'):
                    release_registry.command('sleep', '5')

    def test_open_vsx_is_awaited_while_it_scans_a_fresh_version(self):
        answers = [None, None, {'version': '0.4.0-rc.41'}]
        with patch.object(publish_release, 'api', lambda *a, **k: answers.pop(0)), patch.object(publish_release.time, 'sleep') as sleep, patch('sys.stderr'):
            self.assertEqual(publish_release.open_vsx_extension('0.4.0-rc.41'), {'version': '0.4.0-rc.41'})
        self.assertEqual(sleep.call_count, 2)

    def test_open_vsx_that_never_serves_the_version_fails_after_the_deadline(self):
        with patch.object(publish_release, 'api', lambda *a, **k: None), patch.object(publish_release, 'OPEN_VSX_SCAN_DEADLINE', 0), patch.object(publish_release.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'still does not serve unfold-hq.unfold 0.4.0-rc.41'):
                publish_release.open_vsx_extension('0.4.0-rc.41')
        sleep.assert_not_called()


class GitHubHomeTests(unittest.TestCase):
    def test_open_vsx_is_asked_for_the_extension_the_manifest_names(self):
        urls = []
        with patch.object(publish_release, 'api', lambda url, *a, **k: urls.append(url) or {'version': '0.4.0-rc.41'}):
            publish_release.open_vsx_extension('0.4.0-rc.41')
        namespace, name = publish_release.extension_identity()
        self.assertEqual((namespace, name), ('unfold-hq', 'unfold'))
        self.assertEqual(urls, ['https://open-vsx.org/api/unfold-hq/unfold/0.4.0-rc.41'])

    def test_the_keyless_identity_is_the_publication_workflow_on_a_release_tag(self):
        signer = re.compile(release_registry.GITHUB_SIGNER)
        workflow = 'https://github.com/unfold-hq/unfold/.github/workflows/on_release_published.yml'
        for ref in ['refs/tags/unfold-v0.4.0-rc.140', 'refs/tags/unfold-v0.5.0']:
            self.assertTrue(signer.match(f'{workflow}@{ref}'), ref)
        for subject in [f'{workflow}@refs/heads/development', f'{workflow}@refs/tags/unfold-site-v1.0.0', 'https://github.com/unfold-hq/unfold/.github/workflows/on_release_train.yml@refs/tags/unfold-v0.4.0-rc.140', 'https://github.com/webgrip/unfold/.github/workflows/on_release_published.yml@refs/tags/unfold-v0.4.0-rc.140']:
            self.assertFalse(signer.match(subject), subject)
        self.assertEqual(release_registry.KEYLESS_IDENTITY[2:], ('--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com'))
        self.assertTrue((Path(__file__).resolve().parent.parent / '.github/workflows/on_release_published.yml').is_file(), 'the identity names a workflow that exists')

    def test_a_keyless_signature_is_made_only_when_none_verifies(self):
        reference = 'ghcr.io/unfold-hq/charts/unfold@sha256:' + 'a' * 64
        calls = []

        def cosign(*args, env=None):
            calls.append(args[1])
            if args[1] == 'verify' and len(calls) == 1:
                raise RuntimeError('no signatures found')
            return ''

        with patch.object(release_registry, 'command', side_effect=cosign):
            self.assertTrue(release_registry.sign_keyless_once(reference))
        self.assertEqual(calls, ['verify', 'sign', 'verify'])
        with patch.object(release_registry, 'command', return_value='') as command:
            self.assertFalse(release_registry.sign_keyless_once(reference))
        command.assert_called_once_with('cosign', 'verify', *release_registry.KEYLESS_IDENTITY, reference)

    def test_the_github_chart_points_every_image_at_the_unfold_hq_registry(self):
        root = Path(__file__).resolve().parent.parent
        digests = {'unfold': 'sha256:' + 'a' * 64, 'unfold-agent': 'sha256:' + 'b' * 64}
        values = publish_chart.release_values((root / 'apps/unfold/ops/helm/unfold/values.yaml').read_text(), '0.4.0-rc.9', digests, 'ghcr.io/unfold-hq')
        self.assertIn('image:\n  repository: ghcr.io/unfold-hq/unfold\n  tag: "0.4.0-rc.9"\n  digest: "sha256:' + 'a' * 64 + '"\n', values)
        self.assertIn('\nworkspaceAgentImage:\n  repository: ghcr.io/unfold-hq/unfold-agent\n  tag: "0.4.0-rc.9"\n', values)
        self.assertNotIn('ghcr.io/webgrip/', values.split('workspaceAgentImage:')[0].split('image:', 1)[1].split('\n', 2)[1])

    def test_an_asset_missing_from_a_published_github_release_fails_plainly(self):
        release = {'tag_name': 'unfold-v0.4.0-rc.9', 'draft': False, 'assets': [], 'upload_url': 'https://uploads.github.com/x{?name}'}
        with self.assertRaisesRegex(RuntimeError, 'immutable'):
            publish_release.attach_github(release, 'release-artifacts-unfold.json', b'{}', 'token', publish_release.HOME)

    def test_publication_attaches_the_evidence_to_the_draft_and_then_publishes_it_without_moving_latest(self):
        draft = {'id': 11, 'tag_name': 'unfold-v0.4.0-rc.9', 'draft': True, 'html_url': 'draft', 'upload_url': 'https://uploads.github.com/repos/unfold-hq/unfold/releases/11/assets{?name,label}',
                 'assets': [{'name': 'unfold-0.4.0-rc.9.vsix', 'url': publish_release.HOME + '/releases/assets/1'}]}
        calls, attached = [], []

        def api(url, token, method='GET', data=None, missing=False):
            calls.append((method, url.removeprefix(publish_release.HOME), data))
            if method == 'PATCH':
                return {**draft, **data, 'html_url': 'published'}
            return draft if '/releases/tags/' in url else None

        signed = []
        with patch.dict('os.environ', {'GITHUB_TOKEN': 'token'}), \
                patch.object(publish_release, 'git', lambda *a, **k: 'sha'), \
                patch.object(publish_release, 'refuse_occupied'), \
                patch.object(publish_release, 'api', api), \
                patch.object(publish_release, 'Registry', lambda host: MemoryRegistry(host)), \
                patch.object(publish_release, 'verify_image', lambda registry, repository, version, revision, source: (self.assertEqual(source, 'https://github.com/unfold-hq/unfold'), 'sha256:' + 'c' * 64)[1]), \
                patch.object(publish_release, 'verify_keyless_signature', signed.append), \
                patch.object(publish_release, 'verify_keyless', signed.append), \
                patch.object(publish_release, 'digest', lambda data: 'sha256:' + 'd' * 64), \
                patch.object(MemoryRegistry, 'manifest', lambda self, repository, reference, missing=False: b'chart'), \
                patch.object(publish_release, 'open_vsx_extension', lambda version: {'version': version, 'files': {'download': 'https://open-vsx.org/vsix'}}), \
                patch.object(publish_release, 'request', lambda url, **k: (b'vsix', {})), \
                patch.object(publish_release, 'fetch_github_asset', lambda asset, token, draft, repository: b'vsix'), \
                patch.object(publish_release, 'attach_github', lambda release, name, content, token, repository: attached.append((name, json.loads(content)))):
            publish_release.publish('unfold', '0.4.0-rc.9')
        self.assertEqual(signed, ['ghcr.io/unfold-hq/unfold@sha256:' + 'c' * 64, 'ghcr.io/unfold-hq/unfold-agent@sha256:' + 'c' * 64, 'ghcr.io/unfold-hq/charts/unfold@sha256:' + 'd' * 64])
        self.assertEqual([name for name, _ in attached], ['release-artifacts-unfold.json'])
        evidence = attached[0][1]
        self.assertEqual((evidence['source'], evidence['extension']['id']), ('https://github.com/unfold-hq/unfold', 'unfold-hq.unfold'))
        self.assertEqual(calls[-1], ('PATCH', '/releases/11', {'draft': False, 'make_latest': 'false'}))

class FlakyOpener:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def open(self, req, timeout):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class Answer:
    def __init__(self, body):
        self.body = body
        self.headers = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


class RequestRetryTests(unittest.TestCase):
    def serve(self, *outcomes):
        opener = FlakyOpener(*outcomes)
        patchers = [patch.object(release_registry.urllib.request, 'build_opener', return_value=opener), patch.object(release_registry.time, 'sleep')]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        return opener

    def test_a_read_cut_off_mid_body_is_retried(self):
        opener = self.serve(release_registry.http.client.IncompleteRead(b'', 4557), Answer(b'{}'))
        self.assertEqual(release_registry.request('https://ghcr.io/v2/x/blobs/sha256:a')[0], b'{}')
        self.assertEqual(opener.calls, 2)

    def test_a_dropped_connection_and_a_server_error_are_retried_for_reads(self):
        server_error = urllib.error.HTTPError('https://ghcr.io/v2/x', 503, 'unavailable', {}, None)
        opener = self.serve(ConnectionResetError(), server_error, Answer(b'ok'))
        self.assertEqual(release_registry.request('https://ghcr.io/v2/x', method='HEAD')[0], b'ok')
        self.assertEqual(opener.calls, 3)

    def test_a_write_is_never_repeated(self):
        opener = self.serve(ConnectionResetError())
        with self.assertRaises(ConnectionResetError):
            release_registry.request('https://ghcr.io/v2/x/blobs/uploads/', method='POST', data=b'')
        self.assertEqual(opener.calls, 1)

    def test_a_read_that_keeps_failing_gives_up_after_three_attempts(self):
        cut = release_registry.http.client.IncompleteRead(b'', 1)
        opener = self.serve(cut, cut, cut)
        with self.assertRaises(release_registry.http.client.IncompleteRead):
            release_registry.request('https://ghcr.io/v2/x')
        self.assertEqual(opener.calls, 3)

    def test_a_missing_manifest_and_a_denied_read_are_answers_not_retries(self):
        not_found = urllib.error.HTTPError('https://ghcr.io/v2/x', 404, 'missing', {}, None)
        opener = self.serve(not_found)
        self.assertIsNone(release_registry.request('https://ghcr.io/v2/x', missing=True)[0])
        denied = urllib.error.HTTPError('https://ghcr.io/v2/x', 401, 'denied', {}, None)
        opener = self.serve(denied)
        with self.assertRaisesRegex(RuntimeError, 'HTTP 401'):
            release_registry.request('https://ghcr.io/v2/x')
        self.assertEqual(opener.calls, 1)

if __name__ == '__main__':
    unittest.main()
