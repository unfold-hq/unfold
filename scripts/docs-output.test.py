import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('docs_output', Path(__file__).with_name('docs-output.py'))
output = importlib.util.module_from_spec(spec)
spec.loader.exec_module(output)


class PublishedDocumentation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.staging = root / '.build/docs'
        self.site = root / '.build/site'
        self.staging.mkdir(parents=True)
        self.site.mkdir(parents=True)
        (root / 'mkdocs.yml').write_text('site_url: https://example.test/unfold/\n')
        (self.staging / 'index.md').write_text('# Current\n\n[Page](unfold/index.md)\n')
        (self.staging / 'unfold').mkdir()
        (self.staging / 'unfold/index.md').write_text('# Unfold\n')
        (self.staging / 'llms.txt').write_text('# Unfold\n\n- [Start](index.md)\n')
        (self.staging / 'docs-sources.json').write_text(json.dumps({'revision': 'a' * 40, 'sources': []}))
        for name in ['index.html', 'unfold/index.html', 'ploeg/index.html', 'research/old/index.html', '404.html']:
            page = self.site / name
            page.parent.mkdir(parents=True, exist_ok=True)
            page.write_text('<body><article>page</article></body>')
        (self.site / 'search.json').write_text(json.dumps({'items': [{'location': 'index.html'}]}))
        output.finalize(self.site, self.staging)

    def test_publishable_site_and_curated_bundle(self):
        output.validate(self.site, self.staging)
        self.assertIn('https://example.test/unfold/unfold/index.md', (self.site / 'llms-full.txt').read_text())
        self.assertIn('data-pagefind-ignore', (self.site / 'research/old/index.html').read_text())
        self.assertNotIn('data-pagefind-body', (self.site / 'research/old/index.html').read_text())
        self.assertIn('data-pagefind-body', (self.site / 'index.html').read_text())
        self.assertNotIn('data-pagefind-body', (self.site / '404.html').read_text())

    def test_missing_or_stale_raw_page_blocks_publish(self):
        page = self.site / 'index.md'
        page.unlink()
        with self.assertRaisesRegex(AssertionError, 'Missing or stale Markdown'):
            output.validate(self.site, self.staging)
        page.write_text('stale')
        with self.assertRaisesRegex(AssertionError, 'Missing or stale Markdown'):
            output.validate(self.site, self.staging)

    def test_missing_human_page_blocks_publish(self):
        (self.site / 'unfold/index.html').unlink()
        with self.assertRaisesRegex(AssertionError, 'Missing output'):
            output.validate(self.site, self.staging)

    def test_broken_or_external_machine_link_blocks_publish(self):
        for target, reason in [('https://example.test/unfold/missing.md', 'Broken machine index'), ('https://other.test/', 'escapes site')]:
            (self.site / 'llms.txt').write_text(f'[Bad]({target})')
            with self.assertRaisesRegex(AssertionError, reason):
                output.validate(self.site, self.staging)

    def test_history_cannot_enter_default_bundle(self):
        (self.staging / 'llms.txt').write_text('[Old](research/old.md)')
        with self.assertRaisesRegex(AssertionError, 'Historical page'):
            output.finalize(self.site, self.staging)

    def test_zensical_history_blocks_publish(self):
        (self.site / 'search.json').write_text(json.dumps({'items': [{'location': 'research/old/'}]}))
        with self.assertRaisesRegex(AssertionError, 'History leaked into Zensical'):
            output.validate(self.site, self.staging)

    def test_legacy_target_must_exist(self):
        (self.staging / 'research').mkdir()
        mapping = self.staging / 'research/2026-09-12-docs-cutover.json'
        mapping.write_text(json.dumps({'redirects': [{'to': '/glide/unfold/'}]}))
        output.validate(self.site, self.staging)
        mapping.write_text(json.dumps({'redirects': [{'to': '/glide/missing/'}]}))
        with self.assertRaisesRegex(AssertionError, 'Missing legacy redirect'):
            output.validate(self.site, self.staging)

    def write_schema(self, identifier):
        schema = self.staging / 'unfold/contracts/event.v1.schema.json'
        schema.parent.mkdir(parents=True, exist_ok=True)
        schema.write_text(json.dumps({'$id': identifier}))
        return schema

    def test_schema_is_published_at_its_id(self):
        schema = self.write_schema('https://example.test/unfold/unfold/contracts/event.v1.schema.json')
        with self.assertRaisesRegex(AssertionError, 'Missing or stale schema'):
            output.validate(self.site, self.staging)
        published = self.site / 'unfold/contracts/event.v1.schema.json'
        published.parent.mkdir(parents=True, exist_ok=True)
        published.write_bytes(schema.read_bytes())
        output.validate(self.site, self.staging)
        published.write_text('{}')
        with self.assertRaisesRegex(AssertionError, 'Missing or stale schema'):
            output.validate(self.site, self.staging)

    def test_schema_id_on_the_site_must_name_its_path(self):
        self.write_schema('https://example.test/unfold/contracts/event.v1.schema.json')
        with self.assertRaisesRegex(AssertionError, 'not where the site publishes it'):
            output.validate(self.site, self.staging)

    def test_schema_with_an_id_elsewhere_is_not_checked(self):
        for identifier in ['urn:example:event:1', 'https://other.test/event.v1.schema.json']:
            self.write_schema(identifier)
            self.assertEqual(output.published_schemas(self.staging, 'https://example.test/unfold/'), [])

    def test_mismatched_revision_blocks_publish(self):
        (self.site / 'docs-sources.json').write_text('{}')
        with self.assertRaisesRegex(AssertionError, 'Mismatched source'):
            output.validate(self.site, self.staging)

    def test_code_examples_remain_literal(self):
        for markdown in ['`[Example](relative.md)`', '```md\n[Example](relative.md)\n```']:
            self.assertEqual(output.absolute_links(markdown, 'https://example.test/'), markdown)


if __name__ == '__main__':
    unittest.main()
