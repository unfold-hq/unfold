import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('docs_live', Path(__file__).with_name('docs-live.py'))
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class LivePublication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.staging = Path(self.temp.name)
        manifest = json.dumps({'revision': 'a' * 40, 'sources': [{'path': 'index.md'}]}).encode()
        (self.staging / 'docs-sources.json').write_bytes(manifest)
        (self.staging / 'index.md').write_bytes(b'# Unfold')
        self.responses = {
            'docs-sources.json': manifest,
            'index.md': b'# Unfold',
            '': b'<meta content="zensical-0.0.53">',
            'llms.txt': b'[Home](https://example.test/unfold/index.md)',
            'llms-full.txt': b'a' * 40,
            'search.json': b'{"items":[{"location":""}]}',
            'pagefind/pagefind-entry.json': b'{"languages":{"en":{"page_count":1}}}',
        }

    def verify(self, base='https://example.test/unfold/'):
        return live.verify(base, self.staging, lambda url: self.responses['' if url == base.rstrip('/') else url.removeprefix(base)], site_url='https://example.test/unfold/')

    def test_schema_must_be_served_at_its_id(self):
        schema = json.dumps({'$id': 'https://example.test/unfold/contracts/event.v1.schema.json'}).encode()
        (self.staging / 'contracts').mkdir()
        (self.staging / 'contracts/event.v1.schema.json').write_bytes(schema)
        self.responses['contracts/event.v1.schema.json'] = b'{}'
        with self.assertRaisesRegex(AssertionError, 'stale schema at its \\$id'):
            self.verify()
        self.responses['contracts/event.v1.schema.json'] = schema
        self.assertEqual(self.verify()['schemas'], 1)

    def test_staging_serves_the_schemas_that_production_identifies(self):
        schema = json.dumps({'$id': 'https://example.test/unfold/contracts/event.v1.schema.json'}).encode()
        (self.staging / 'contracts').mkdir()
        (self.staging / 'contracts/event.v1.schema.json').write_bytes(schema)
        self.responses['contracts/event.v1.schema.json'] = schema
        self.responses['llms.txt'] = b'[Home](https://staging.example.test/unfold/index.md)'
        self.assertEqual(self.verify('https://staging.example.test/unfold/')['schemas'], 1)

    def test_staging_serves_the_machine_index_that_names_production(self):
        self.assertEqual(self.verify('https://staging.example.test/unfold/')['machine_index_links'], 1)
        self.responses['llms.txt'] = b'[Home](https://elsewhere.example.test/index.md)'
        with self.assertRaisesRegex(AssertionError, 'Machine index leaves the site'):
            self.verify('https://staging.example.test/unfold/')

    def test_directory_redirect_must_keep_the_public_prefix(self):
        url = 'https://example.test/unfold/unfold'
        with patch.object(live, 'urlopen') as request:
            response = request.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'page'
            response.url = url + '/'
            self.assertEqual(live.read_url(url), b'page')
            response.url = 'https://example.test/unfold/'
            with self.assertRaisesRegex(AssertionError, 'Unexpected redirect'):
                live.read_url(url)

    def test_a_dropped_connection_is_retried_and_an_http_error_is_not(self):
        url = 'https://example.test/unfold/'
        with patch.object(live, 'read_once', side_effect=[ConnectionResetError('reset'), b'page']) as read, patch.object(live.time, 'sleep'):
            self.assertEqual(live.read_url(url), b'page')
            self.assertEqual(read.call_count, 2)
        with patch.object(live, 'read_once', side_effect=[live.HTTPException('IncompleteRead'), b'page']) as read, patch.object(live.time, 'sleep'):
            self.assertEqual(live.read_url(url), b'page')
            self.assertEqual(read.call_count, 2)
        starting = live.HTTPError(url, 522, 'Connection timed out', {}, None)
        with patch.object(live, 'read_once', side_effect=[starting, b'page']) as read, patch.object(live.time, 'sleep'):
            self.assertEqual(live.read_url(url), b'page')
            self.assertEqual(read.call_count, 2)
        refused = live.HTTPError(url, 403, 'Forbidden', {}, None)
        with patch.object(live, 'read_once', side_effect=[refused, b'page']) as read, patch.object(live.time, 'sleep'):
            with self.assertRaises(live.HTTPError):
                live.read_url(url)
            self.assertEqual(read.call_count, 1)
        with patch.object(live, 'read_once', side_effect=ConnectionResetError('reset')) as read, patch.object(live.time, 'sleep'):
            with self.assertRaises(ConnectionResetError):
                live.read_url(url)
            self.assertEqual(read.call_count, 6)

    def test_a_deploy_that_is_still_propagating_is_read_again_until_it_settles(self):
        fresh = self.responses['index.md']
        reads = []

        def read(url):
            name = url.removeprefix('https://example.test/unfold/')
            if name == 'index.md':
                reads.append(name)
                return b'# Unfold, the previous revision' if len(reads) < 3 else fresh
            return self.responses['' if url == 'https://example.test/unfold' else name]

        now = [0.0]
        sleep = lambda seconds: now.__setitem__(0, now[0] + seconds)
        result = live.verify_settled('https://example.test/unfold/', self.staging, read, site_url='https://example.test/unfold/', settle_seconds=60, pause=15, clock=lambda: now[0], sleep=sleep)
        self.assertEqual(result['human_pages'], 1)
        self.assertEqual(now[0], 30)

    def test_a_publication_that_stays_stale_fails_once_the_settle_time_is_spent(self):
        self.responses['index.md'] = b'# Unfold, the previous revision'
        now = [0.0]
        sleep = lambda seconds: now.__setitem__(0, now[0] + seconds)
        with self.assertRaisesRegex(AssertionError, 'stale Markdown'):
            live.verify_settled('https://example.test/unfold/', self.staging, lambda url: self.responses['' if url == 'https://example.test/unfold' else url.removeprefix('https://example.test/unfold/')], site_url='https://example.test/unfold/', settle_seconds=60, pause=15, clock=lambda: now[0], sleep=sleep)
        self.assertEqual(now[0], 60)

    def test_matching_publication_passes(self):
        self.assertEqual(self.verify()['human_pages'], 1)

    def test_stale_revision_or_missing_export_fails(self):
        self.responses['docs-sources.json'] = b'{}'
        with self.assertRaisesRegex(AssertionError, 'Published sources'):
            self.verify()
        self.responses['docs-sources.json'] = (self.staging / 'docs-sources.json').read_bytes()
        self.responses['index.md'] = b'<html>not the document</html>'
        with self.assertRaisesRegex(AssertionError, 'stale Markdown'):
            self.verify()

    def test_wrong_human_renderer_fails(self):
        self.responses[''] = b'<html>error page</html>'
        with self.assertRaisesRegex(AssertionError, 'Missing Zensical'):
            self.verify()

    def test_historical_search_and_pagefind_scope_fail(self):
        self.responses['search.json'] = b'{"items":[{"location":"research/old/"}]}'
        with self.assertRaisesRegex(AssertionError, 'includes history'):
            self.verify()
        self.responses['search.json'] = b'{"items":[{"location":""}]}'
        self.responses['pagefind/pagefind-entry.json'] = b'{"languages":{"en":{"page_count":2}}}'
        with self.assertRaisesRegex(AssertionError, 'Pagefind page count'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
