import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cve_budget  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def match(identifier, severity, package='openssl'):
    return {'vulnerability': {'id': identifier, 'severity': severity}, 'artifact': {'name': package, 'version': '1.0'}}


class CveBudget(unittest.TestCase):
    def run_gate(self, matches, budgets, image='unfold', ignored=0):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'grype.json'
            report.write_text(json.dumps({'descriptor': {'version': '0.121.0'}, 'matches': matches, 'ignoredMatches': [{}] * ignored}))
            budget_file = Path(directory) / 'budgets.yaml'
            budget_file.write_text(budgets)
            output = Path(directory) / 'cve-budget.json'
            summary = Path(directory) / 'summary.md'
            with contextlib.redirect_stdout(io.StringIO()), mock.patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(summary)}):
                status = cve_budget.main(str(report), str(budget_file), image, 'ghcr.io/unfold-hq/unfold@sha256:' + 'a' * 64, str(output))
            self.assertIn(f'### CVE budget: {image}', summary.read_text())
            return status, json.loads(output.read_text())

    def test_the_committed_budgets_enforce_zero_critical_and_high_for_both_images(self):
        budgets = (ROOT / 'apps/unfold/ops/security/cve-budgets.yaml').read_text()
        for image in ['unfold', 'unfold-agent']:
            status, predicate = self.run_gate([match('CVE-1', 'Medium')], budgets, image)
            self.assertEqual((status, predicate['met']), (0, True), image)
            status, predicate = self.run_gate([match('CVE-2', 'High')], budgets, image)
            self.assertEqual((status, predicate['met']), (1, False), image)

    def test_a_vulnerability_found_twice_in_one_package_counts_once(self):
        status, predicate = self.run_gate([match('CVE-3', 'High'), match('CVE-3', 'High')], 'defaults:\n  mode: enforce\n  high: 1\n')
        self.assertEqual((status, predicate['found']['high']), (0, 1))

    def test_a_reporting_budget_warns_instead_of_failing(self):
        status, predicate = self.run_gate([match('CVE-4', 'Critical')], 'defaults:\n  mode: report\n  critical: 0\n', ignored=2)
        self.assertEqual((status, predicate['met'], predicate['suppressedByVex']), (0, False, 2))

    def test_the_summary_names_what_is_over_the_budget_and_where(self):
        finding = {
            'vulnerability': {'id': 'GHSA-fc5q-39xc-vjpf', 'severity': 'High', 'dataSource': 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', 'fix': {'versions': [], 'state': 'not-fixed'}},
            'relatedVulnerabilities': [{'id': 'CVE-2026-112366'}],
            'artifact': {'name': 'picomatch', 'version': '4.0.7', 'type': 'npm', 'locations': [{'path': '/usr/lib/node_modules/node-gyp/node_modules/picomatch/package.json'}]},
        }
        fixed = {'vulnerability': {'id': 'CVE-5', 'severity': 'Medium', 'fix': {'versions': ['1.1']}}, 'artifact': {'name': 'openssl', 'version': '1.0', 'type': 'apk'}}
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'grype.json'
            report.write_text(json.dumps({'matches': [finding, fixed]}))
            budget_file = Path(directory) / 'budgets.yaml'
            budget_file.write_text('defaults:\n  mode: enforce\n  high: 0\n')
            summary = Path(directory) / 'summary.md'
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed), mock.patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(summary)}):
                status = cve_budget.main(str(report), str(budget_file), 'unfold-agent', 'ref', str(Path(directory) / 'out.json'))
            text = summary.read_text()
        self.assertEqual(status, 1)
        self.assertIn('❌ **unfold-agent is over its CVE budget: 1 high.**', text)
        self.assertIn('| high | [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (CVE-2026-112366) | `picomatch` (npm) | 4.0.7 | no fix released | `/usr/lib/node_modules/node-gyp/node_modules/picomatch/package.json` |', text)
        self.assertIn('1 other finding(s) within the budget', text)
        self.assertIn('| medium | [CVE-5](https://nvd.nist.gov/vuln/detail/CVE-5) | `openssl` (apk) | 1.0 | 1.1 |  |', text)
        self.assertIn('::error title=CVE budget: unfold-agent::unfold-agent is over its CVE budget: 1 high (GHSA-fc5q-39xc-vjpf in picomatch 4.0.7)', printed.getvalue())

    def test_a_clean_image_says_so(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'grype.json'
            report.write_text(json.dumps({'matches': []}))
            budget_file = Path(directory) / 'budgets.yaml'
            budget_file.write_text('defaults:\n  mode: enforce\n  critical: 0\n  high: 0\n')
            summary = Path(directory) / 'summary.md'
            with contextlib.redirect_stdout(io.StringIO()), mock.patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(summary)}):
                cve_budget.main(str(report), str(budget_file), 'unfold', 'ref', str(Path(directory) / 'out.json'))
            text = summary.read_text()
        self.assertIn('✅ **unfold is within its CVE budget.**', text)
        self.assertNotIn('What is over the budget', text)

    def test_a_budget_without_a_mode_reaches_no_verdict(self):
        with self.assertRaisesRegex(ValueError, 'mode enforce or report'):
            self.run_gate([], 'defaults:\n  high: 0\n')


if __name__ == '__main__':
    unittest.main()
