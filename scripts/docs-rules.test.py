import datetime
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('docs_rules', Path(__file__).with_name('docs-rules.py'))
rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rules)


class RemovedFromTree(unittest.TestCase):
    def test_a_removed_directory_or_file_names_the_last_commit_that_held_it(self):
        for path in ['.forgejo', '.forgejo/workflows/on_release_train.yml', 'scripts/workflow-policy.test.cjs']:
            self.assertRegex(rules.removed_revision(path) or '', r'^[0-9a-f]{40}$', path)

    def test_a_path_still_in_the_tree_or_merely_alike_has_no_removal(self):
        for path in ['.github/workflows/on_release_train.yml', '.forgejo-notes.md', 'scripts/github-workflow-policy.test.cjs']:
            self.assertIsNone(rules.removed_revision(path), path)

    def test_every_removed_path_is_absent_from_the_tree(self):
        root = Path(__file__).resolve().parent.parent
        for path in rules.REMOVED_FROM_TREE:
            self.assertFalse((root / path).exists(), path)


class HistoryClassification(unittest.TestCase):
    def test_records_are_history(self):
        for path in [
            'research/2026-09-12-execution-boundary.md',
            'research/old/#stale',
            'unfold/research/evidence/delivery-2026-09-11/README.md',
            'unfold/adrs/0001-the-human-workbench-beside-ploeg.md',
            'unfold/adrs/0001-the-human-workbench-beside-ploeg/',
            'adr/adr-0001-unfold-contains-independent-applications.md',
            'unfold/design/gap-register.md',
            'ploeg/design/',
            'ploeg/backlog.md',
            'unfold/operations/backlog/',
            'unfold/operations/iteration-0.2.0.md',
            'migration-proposal.md',
            'ploeg/openspec/changes/x/design.md',
            'unfold/design/00-product-system-design.md',
            'unfold/design/00-product-system-design/',
            'unfold/PRODUCT-DESIGN.md',
            'unfold/PRODUCT-DESIGN/index.html',
            'unfold/product/go-to-market.md',
            'unfold/product/go-to-market/',
            'unfold/operations/backlog.md',
            'ploeg/backlog/',
            'ploeg/history/legacy-changelog.md',
            'ploeg/history/legacy-changelog/',
        ]:
            self.assertTrue(rules.historical(path), path)

    def test_current_pages_and_ledger_indexes_are_not_history(self):
        for path in ['index.md', 'index.html', '', 'workflows/local-demo.md', 'unfold/operations/live/', 'adr/index.md', 'adr/', 'unfold/adrs/README.md', 'unfold/adrs/', 'reference/decisions.md']:
            self.assertFalse(rules.historical(path), path)


    def test_brand_folders_are_parked_except_the_trademark_policy(self):
        for path in ['unfold/brand/README.md', 'unfold/brand/', 'unfold/brand/social-profile-copy.md', 'unfold/brand/brandbook.html', 'ploeg/brand/README.md', 'ploeg/brand/merkgids.html']:
            self.assertTrue(rules.historical(path), path)
        for path in ['unfold/brand/TRADEMARK.md', 'unfold/brand/TRADEMARK/', 'ploeg/brand/TRADEMARK.md', 'ploeg/brand/TRADEMARK.html']:
            self.assertFalse(rules.historical(path), path)


class Anchors(unittest.TestCase):
    def test_heading_slugs_follow_python_markdown(self):
        markdown = '# Run the `unified` workbench\n\n## Recovery\n\n## Recovery\n\n### R8\n\n## `kagent` / `kars` / agent-sandbox\n\n## See [the guide](x.md) & more\n\n```md\n## Not a heading\n```\n'
        found = rules.anchors(markdown)
        for anchor in ['run-the-unified-workbench', 'recovery', 'recovery_1', 'r8', 'kagent-kars-agent-sandbox', 'see-the-guide-more']:
            self.assertIn(anchor, found)
        self.assertNotIn('not-a-heading', found)

    def test_explicit_and_html_ids(self):
        found = rules.anchors('## Title {#custom}\n\n<a id="legacy"></a>\n')
        self.assertIn('custom', found)
        self.assertIn('legacy', found)
        self.assertNotIn('title', found)


class HistoryBanner(unittest.TestCase):
    def test_banner_follows_the_title_and_front_matter_is_merged(self):
        staged = rules.mark_history('---\nstatus: proposed\ndate: 2026-09-10\n---\n\n# Decision\n\nBody\n', 'unfold/adrs/0017-x.md')
        self.assertEqual(staged, '---\nstatus: proposed\ndate: 2026-09-10\nsearch:\n  exclude: true\n---\n\n# Decision\n\n> Record from 2026-09-10; not current guidance.\n\nBody\n')

    def test_date_sources_and_unknown_date(self):
        self.assertIn('Record from 2026-09-12;', rules.mark_history('# Audit\n', 'unfold/research/2026-09-12-documentation-audit.md'))
        self.assertIn('Record from 2026-09-09;', rules.mark_history('# 0001 — Title\n\nDate: 2026-09-09. Status: accepted.\n', 'unfold/adrs/0001-title.md'))
        self.assertIn('Record from 2026-09-11;', rules.mark_history('# Evidence\n', 'unfold/research/evidence/delivery-2026-09-11/README.md'))
        staged = rules.mark_history('Intro without a title\n', 'ploeg/backlog.md')
        self.assertTrue(staged.startswith('---\nsearch:\n  exclude: true\n---\n> Record; not current guidance.\n'))

    def test_existing_search_setting_is_kept(self):
        staged = rules.mark_history('---\nsearch:\n  exclude: false\n---\n# Page\n', 'research/page.md')
        self.assertEqual(staged.count('search:'), 1)


class Orphans(unittest.TestCase):
    def test_nav_pages_and_one_hop_links_are_reachable(self):
        nav = rules.nav_pages([{'Start': 'index.md'}, {'Apps': [{'Unfold': 'unfold/index.md'}, 'https://example.test/']}])
        self.assertEqual(nav, {'index.md', 'unfold/index.md'})
        links = {'unfold/index.md': {'unfold/live.md'}, 'unfold/live.md': {'unfold/deep.md'}}
        pages = ['index.md', 'unfold/index.md', 'unfold/live.md', 'unfold/deep.md', 'unfold/research/old.md']
        self.assertEqual(rules.orphans(pages, nav, links), ['unfold/deep.md'])

    def test_a_pinned_dependency_page_is_never_an_orphan(self):
        nav = {'index.md', 'ploeg/index.md'}
        pages = ['index.md', 'ploeg/index.md', 'ploeg/how-to/added-upstream.md', 'loose.md']
        self.assertEqual(rules.orphans(pages, nav, {}), ['loose.md'])
        self.assertTrue(rules.pinned('ploeg/how-to/added-upstream.md'))
        self.assertFalse(rules.pinned('unfold/how-to/x.md'))
        self.assertFalse(rules.pinned('reference/ploeg-terms.md'))


TODAY = datetime.date(2026, 9, 23)
VALID = '---\ntype: how-to\naudience: [owner, operator]\nowner: unfold\nlast_verified: 2026-09-22\nverified_by: "mise run docs-check"\n---\n\n# Page\n'
GENERATED = '---\ntype: reference\naudience: [owner, agent]\nowner: ploeg\ngenerated_by: "mise run domain"\n---\n\n# Glossary\n'


class FrontMatter(unittest.TestCase):
    def test_checked_pages_are_current_nav_pages_and_the_required_folders(self):
        pages = ['index.md', 'extra.md', 'concepts/new.md', 'how-to/x.md', 'reference/glossary.md', 'reference/data.yaml', 'research/2026-09-12-x.md', 'unfold/index.md', 'adr/adr-0001-x.md']
        nav = {'index.md', 'unfold/index.md', 'research/2026-09-12-x.md', 'adr/adr-0001-x.md'}
        self.assertEqual(rules.checked_pages(pages, nav), ['concepts/new.md', 'how-to/x.md', 'index.md', 'reference/glossary.md', 'unfold/index.md'])

    def test_pinned_dependency_pages_keep_their_own_front_matter_rules(self):
        pages = ['index.md', 'ploeg/index.md', 'ploeg/how-to/x.md', 'ploeg/reference/configuration.md']
        self.assertEqual(rules.checked_pages(pages, {'index.md', 'ploeg/index.md', 'ploeg/reference/configuration.md'}), ['index.md'])

    def test_valid_verified_and_generated_pages_pass(self):
        self.assertEqual(rules.front_matter_problems(VALID, TODAY), [])
        self.assertEqual(rules.front_matter_problems(GENERATED, TODAY), [])

    def test_missing_front_matter_and_invalid_yaml(self):
        self.assertEqual(rules.front_matter_problems('# Page\n', TODAY), ['no front matter'])
        self.assertEqual(rules.front_matter_problems('---\ntype: [\n---\n# Page\n', TODAY), ['front matter is not valid YAML'])

    def test_last_verified_may_be_one_day_ahead_of_the_utc_date(self):
        tomorrow = (TODAY + datetime.timedelta(days=1)).isoformat()
        later = (TODAY + datetime.timedelta(days=2)).isoformat()
        self.assertEqual(rules.front_matter_problems(VALID.replace('2026-09-22', tomorrow), TODAY), [])
        self.assertEqual(rules.front_matter_problems(VALID.replace('2026-09-22', later), TODAY), ['last_verified is in the future'])

    def test_each_field_is_validated(self):
        cases = {
            'type: how-to': ('type: record', 'type must be'),
            'audience: [owner, operator]': ('audience: owner', 'audience must be'),
            'owner: unfold': ('owner: acme', 'owner must be'),
            'last_verified: 2026-09-22': ('last_verified: 2026-12-01', 'in the future'),
            'verified_by: "mise run docs-check"\n': ('', 'verified_by must'),
        }
        for original, (replacement, message) in cases.items():
            problems = rules.front_matter_problems(VALID.replace(original, replacement), TODAY)
            self.assertEqual(len(problems), 1, (replacement, problems))
            self.assertIn(message, problems[0])
        self.assertIn('audience must be', rules.front_matter_problems(VALID.replace('[owner, operator]', '[owner, reader]'), TODAY)[0])
        self.assertIn('YYYY-MM-DD', rules.front_matter_problems(VALID.replace('2026-09-22', 'last week'), TODAY)[0])

    def test_only_generated_reference_pages_may_omit_last_verified(self):
        unverified = VALID.replace('last_verified: 2026-09-22\nverified_by: "mise run docs-check"\n', '')
        self.assertIn('last_verified is required', rules.front_matter_problems(unverified, TODAY)[0])
        self.assertIn('last_verified is required', rules.front_matter_problems(GENERATED.replace('generated_by: "mise run domain"\n', ''), TODAY)[0])
        self.assertEqual(rules.front_matter_problems(GENERATED.replace('type: reference', 'type: explanation'), TODAY), ['generated_by is only for generated reference pages'])

    def test_an_unverified_page_states_why_instead_of_a_date(self):
        marked = VALID.replace('last_verified: 2026-09-22\nverified_by: "mise run docs-check"\n', 'unverified: "contradicts ADR-0002"\n')
        self.assertEqual(rules.front_matter_problems(marked, TODAY), [])
        self.assertEqual(rules.front_matter_problems(marked.replace('"contradicts ADR-0002"', '""'), TODAY)[0][:24], 'last_verified is require')
        self.assertEqual(rules.front_matter_problems(VALID.replace('owner: unfold\n', 'owner: unfold\nunverified: "x"\n'), TODAY), ['unverified excludes last_verified and generated_by'])
        self.assertEqual(rules.unverified({'a.md': marked, 'b.md': VALID}), [('a.md', 'contradicts ADR-0002')])


class Staleness(unittest.TestCase):
    def test_reports_pages_older_than_the_threshold_oldest_first(self):
        pages = {
            'fresh.md': VALID,
            'edge.md': VALID.replace('2026-09-22', '2026-03-27'),
            'old.md': VALID.replace('2026-09-22', '2026-03-26'),
            'older.md': VALID.replace('2026-09-22', '2025-01-01'),
            'generated.md': GENERATED,
            'bare.md': '# No front matter\n',
            'broken.md': '---\ntype: [\n---\n',
        }
        self.assertEqual(rules.stale(pages, TODAY), [('older.md', datetime.date(2025, 1, 1), 630), ('old.md', datetime.date(2026, 3, 26), 181)])
        self.assertEqual(rules.stale(pages, TODAY, days=1000), [])


VOCABULARY = {
    'statuses': {'available': 'Available', 'planned': 'Planned'},
    'owners': {'ploeg': 'Ploeg', 'unfold': 'Unfold'},
    'kinds': {'registry': 'Adapter registry'},
    'methods': {'token': 'pasted token', 'oauth': 'OAuth', 'service_account': 'service account'},
    'mechanisms': {'webhooks': 'webhooks', 'rest': 'REST API'},
    'does': {'intake': 'intake', 'read': 'read tasks'},
}
INTEGRATIONS = {'vocabulary': VOCABULARY, 'standards': [{'id': 'mcp', 'name': 'MCP', 'status': 'available'}], 'ports': [{
    'id': 'trackers', 'label': 'Trackers', 'kind': 'registry', 'openSocket': True, 'description': 'Where work comes from.',
    'placeholder': {'id': 'tracker', 'label': 'Issue tracker', 'fields': {'name': {'label': 'Name', 'any': 'your issue tracker'}, 'branch': {'label': 'Agent branch', 'code': True, 'any': 'agent/<tracker>-<id>'}}},
    'adapters': [
        {'id': 'vikunja', 'name': 'Vikunja', 'status': 'available', 'owner': 'ploeg', 'provider': 'vikunja', 'static': '`PLOEG_VIKUNJA_URL`', 'mechanisms': ['webhooks'], 'does': ['intake'], 'branch': 'agent/vik-<id>'},
        {'id': 'clickup', 'name': 'ClickUp', 'status': 'available', 'owner': 'ploeg', 'provider': 'clickup', 'runtime': ['token'], 'planned': ['service_account'], 'mechanisms': ['webhooks', 'rest'], 'does': ['intake'], 'docs': ['docs/how-to/connect-clickup.md'], 'branch': 'agent/CU-<id>'},
        {'id': 'jira', 'name': 'Jira Cloud', 'label': 'jiraLabel', 'note': 'read', 'status': 'available', 'owner': 'unfold', 'mechanisms': ['rest'], 'does': ['read']},
    ],
}]}
PLOEG = {'providers': {'vikunja', 'clickup'}, 'methods': {'token', 'oauth'}, 'connectors': {'clickup': {'token', 'oauth'}}, 'references': {'clickup': 'CU-'}}


def with_adapter(index, **changes):
    port = INTEGRATIONS['ports'][0]
    adapters = [dict(adapter, **changes) if position == index else adapter for position, adapter in enumerate(port['adapters'])]
    return dict(INTEGRATIONS, ports=[dict(port, adapters=adapters)])


class IntegrationPlaceholders(unittest.TestCase):
    def expand(self, markdown, data=INTEGRATIONS):
        return rules.expand_integrations(markdown, data, '../reference/integrations.md', lambda path: f'[{path}](../{path})')

    def test_a_placeholder_shows_the_neutral_text_and_every_integration_on_hover(self):
        markdown, problems = self.expand('Push to {{ tracker.branch }}.')
        self.assertEqual(problems, [])
        self.assertEqual(markdown, 'Push to [`agent/<tracker>-<id>`](../reference/integrations.md#tracker "Vikunja: agent/vik-<id> · ClickUp: agent/CU-<id>"){ .unfold-choice data-choice="tracker.branch" }.')

    def test_a_bare_category_means_its_name(self):
        markdown, _ = self.expand('Open {{ tracker }}.')
        self.assertIn('[your issue tracker](', markdown)
        self.assertIn('data-choice="tracker.name"', markdown)

    def test_a_table_lists_every_adapter_that_carries_the_fields(self):
        markdown, _ = self.expand('{{ tracker.table }}')
        self.assertEqual(markdown.splitlines(), ['| Name | Agent branch |', '| --- | --- |', '| Vikunja | `agent/vik-<id>` |', '| ClickUp | `agent/CU-<id>` |'])

    def test_the_catalogue_gives_each_port_a_section_with_how_each_adapter_connects(self):
        markdown, problems = self.expand('{{ catalogue.ports }}')
        self.assertEqual(problems, [])
        lines = markdown.splitlines()
        self.assertEqual(lines[0], '### Trackers { #port-trackers }')
        self.assertEqual(lines[2], 'Adapter registry. Where work comes from.')
        self.assertIn('| Vikunja | Available | Ploeg | intake | configuration: `PLOEG_VIKUNJA_URL` | webhooks | - |', lines)
        self.assertIn('| ClickUp | Available | Ploeg | intake | at runtime: pasted token; planned: service account | webhooks, REST API | [docs/how-to/connect-clickup.md](../docs/how-to/connect-clickup.md) |', lines)
        self.assertIn('| Jira Cloud | Available | Unfold | read tasks | - | REST API | - |', lines)

    def test_code_is_left_alone(self):
        for markdown in ['`{{ tracker }}`', '```yaml\nname: {{ tracker }}\n```', '`{{ catalogue.ports }}`']:
            self.assertEqual(self.expand(markdown), (markdown, []))

    def test_an_unknown_placeholder_is_a_problem(self):
        self.assertEqual(self.expand('{{ trackr }} {{ tracker.colour }} {{ catalogue.colour }}')[1], ['{{ trackr }}', '{{ tracker.colour }}', '{{ catalogue.colour }}'])


class IntegrationCatalogue(unittest.TestCase):
    def test_the_catalogue_matches_ploeg(self):
        self.assertEqual(rules.integration_problems(INTEGRATIONS, PLOEG), [])

    def test_a_provider_ploeg_lacks_is_a_problem(self):
        self.assertEqual(rules.integration_problems(with_adapter(0, provider='jira'), PLOEG), [
            'trackers.vikunja: Ploeg has no provider named jira',
            "trackers.vikunja: Ploeg names the branch agent/jira-<id>, not agent/vik-<id>",
            'Ploeg has a provider named vikunja, but no tracker or forge adapter names it',
        ])

    def test_a_branch_ploeg_does_not_derive_is_a_problem(self):
        self.assertEqual(rules.integration_problems(with_adapter(1, branch='agent/clickup-<id>'), PLOEG), ['trackers.clickup: Ploeg names the branch agent/CU-<id>, not agent/clickup-<id>'])

    def test_a_runtime_method_the_connector_does_not_serve_is_a_problem(self):
        self.assertEqual(rules.integration_problems(with_adapter(1, runtime=['token', 'service_account']), PLOEG), ['trackers.clickup: Ploeg serves no connection method service_account; list it under planned'])
        self.assertEqual(rules.integration_problems(with_adapter(0, runtime=['oauth']), PLOEG), ["trackers.vikunja: Ploeg's vikunja connector does not serve oauth"])

    def test_a_planned_method_ploeg_now_serves_must_move(self):
        self.assertEqual(rules.integration_problems(with_adapter(1, planned=['oauth']), PLOEG), ['trackers.clickup: Ploeg serves oauth now; move it from planned to runtime'])

    def test_a_ploeg_connector_or_provider_the_catalogue_misses_is_a_problem(self):
        wider = dict(PLOEG, providers=PLOEG['providers'] | {'gitlab'}, connectors=dict(PLOEG['connectors'], gitlab={'oauth'}))
        self.assertEqual(rules.integration_problems(INTEGRATIONS, wider), [
            'Ploeg connects gitlab at runtime, but no tracker or forge adapter lists its runtime methods',
            'Ploeg has a provider named gitlab, but no tracker or forge adapter names it',
        ])

    def test_words_outside_the_vocabulary_are_problems(self):
        self.assertEqual(rules.integration_problems(with_adapter(2, status='soon', mechanisms=['fax']), PLOEG), ['trackers.jira: unknown status soon', 'trackers.jira: unknown mechanisms entry fax'])

    def test_ploeg_facts_come_from_its_go_sources(self):
        connectors = 'func connectors() map[string]provider.Connector {\n\treturn map[string]provider.Connector{\n\t\t"clickup": {Authorizer: clickup.Connector{}, Prober: clickup.Connector{}},\n\t\t"github":  {Prober: github.Connector{}, Manifest: github.Connector{}},\n\t}\n}\n'
        facts = rules.ploeg_integration_facts(
            'func (p *Provider) Name() string { return "clickup" }\nconst Name = "github"\n',
            'const (\n\tMethodOAuth = "oauth"\n\tMethodToken = "token"\n)\n',
            connectors,
            'work.RegisterReferenceNamer("clickup", clickup.Reference)\n',
            {'clickup': 'func Reference(externalID string) string { return "CU-" + externalID }\n'},
        )
        self.assertEqual(facts, {
            'providers': {'clickup', 'github'}, 'methods': {'oauth', 'token'},
            'connectors': {'clickup': {'oauth', 'token'}, 'github': {'token', 'github_app_manifest', 'github_app_installation'}},
            'references': {'clickup': 'CU-'},
        })

    def test_the_site_gets_names_or_translated_labels_notes_and_statuses_in_order(self):
        self.assertEqual(rules.site_integrations(INTEGRATIONS), {
            'ports': [{'id': 'trackers', 'kind': 'registry', 'openSocket': True, 'adapters': [
                {'name': 'Vikunja', 'status': 'available'},
                {'name': 'ClickUp', 'status': 'available'},
                {'label': 'jiraLabel', 'note': 'read', 'status': 'available'},
            ]}],
            'standards': [{'id': 'mcp', 'name': 'MCP', 'status': 'available'}],
        })

    def test_the_placeholder_data_the_docs_page_script_reads_keeps_its_shape(self):
        self.assertEqual(rules.placeholder_categories(INTEGRATIONS)[0]['choices'], [
            {'id': 'vikunja', 'name': 'Vikunja', 'branch': 'agent/vik-<id>'},
            {'id': 'clickup', 'name': 'ClickUp', 'branch': 'agent/CU-<id>'},
        ])


if __name__ == '__main__':
    unittest.main()
