import json
import os
import sys
from collections import Counter

import yaml

SEVERITIES = ['critical', 'high', 'medium', 'low']
TROUBLESHOOTING = 'https://github.com/unfold-hq/unfold/blob/development/docs/operations/ci-troubleshooting.md'
VEX_GUIDE = 'https://github.com/unfold-hq/unfold/blob/development/apps/unfold/ops/vex/README.md'


def budget_for(budgets, image):
    budget = {**(budgets.get('defaults') or {}), **((budgets.get('images') or {}).get(image) or {})}
    if budget.get('mode') not in ('enforce', 'report'):
        raise ValueError(f'the CVE budget of {image} needs mode enforce or report, got {budget.get("mode")!r}')
    return budget


def findings(report):
    unique = {}
    for match in report.get('matches', []):
        vulnerability, artifact = match['vulnerability'], match['artifact']
        key = (vulnerability['id'], artifact['name'], artifact['version'])
        if key in unique:
            continue
        fix = vulnerability.get('fix') or {}
        unique[key] = {
            'id': vulnerability['id'],
            'severity': vulnerability.get('severity', '').lower(),
            'aliases': sorted({related['id'] for related in match.get('relatedVulnerabilities') or [] if related.get('id') and related['id'] != vulnerability['id']}),
            'url': vulnerability.get('dataSource', ''),
            'package': artifact['name'],
            'version': artifact['version'],
            'type': artifact.get('type', ''),
            'fixedIn': list(fix.get('versions') or []),
            'location': next((location.get('path') for location in artifact.get('locations') or [] if location.get('path')), ''),
        }
    order = {severity: rank for rank, severity in enumerate(SEVERITIES)}
    return sorted(unique.values(), key=lambda finding: (order.get(finding['severity'], len(SEVERITIES)), finding['id'], finding['package']))


def verdict(budget, found):
    over = {severity: found.get(severity, 0) for severity in SEVERITIES if severity in budget and found.get(severity, 0) > int(budget[severity])}
    return over


def advisory_link(identifier, fallback):
    if identifier.startswith('GHSA-'):
        return f'https://github.com/advisories/{identifier}'
    if identifier.startswith('CVE-'):
        return f'https://nvd.nist.gov/vuln/detail/{identifier}'
    return fallback


def cell(text):
    return str(text).replace('|', '\\|').replace('\n', ' ')


def finding_row(finding):
    link = advisory_link(finding['id'], finding['url'])
    name = f'[{finding["id"]}]({link})' if link else finding['id']
    aliases = f' ({", ".join(finding["aliases"])})' if finding['aliases'] else ''
    fixed = ', '.join(finding['fixedIn']) if finding['fixedIn'] else 'no fix released'
    kind = f' ({finding["type"]})' if finding['type'] else ''
    where = f'`{cell(finding["location"])}`' if finding['location'] else ''
    return f'| {finding["severity"]} | {name}{cell(aliases)} | `{cell(finding["package"])}`{cell(kind)} | {cell(finding["version"])} | {cell(fixed)} | {where} |'


def findings_table(rows):
    return ['| Severity | Vulnerability | Package | Installed | Fixed in | Where |', '| --- | --- | --- | --- | --- | --- |', *[finding_row(finding) for finding in rows]]


def short(finding):
    return f'{finding["id"]} in {finding["package"]} {finding["version"]}'


def summary_lines(image, reference, scanner, budget, found, over, all_findings, suppressed):
    enforcing = budget['mode'] == 'enforce'
    if not over:
        headline = f'✅ **{image} is within its CVE budget.**'
    else:
        totals = ', '.join(f'{count} {severity}' for severity, count in over.items())
        headline = f'{"❌" if enforcing else "⚠️"} **{image} is over its CVE budget: {totals}.**{"" if enforcing else " The budget only reports, so the job does not fail."}'
    scanned = f'Grype {scanner} scanned `{reference}`.' if scanner else f'Grype scanned `{reference}`.'
    lines = [f'### CVE budget: {image}', '', headline, '', scanned, '', '| Severity | Found | Budget | |', '| --- | --- | --- | --- |']
    for severity in SEVERITIES:
        limit = budget.get(severity, 'none')
        mark = '❌' if severity in over else ('✅' if severity in budget else '')
        lines.append(f'| {severity} | {found.get(severity, 0)} | {limit} | {mark} |')
    blocking = [finding for finding in all_findings if finding['severity'] in over]
    rest = [finding for finding in all_findings if finding['severity'] not in over]
    if blocking:
        lines += ['', '#### What is over the budget', '', *findings_table(blocking)]
        lines += ['', f'To fix it: move the package to a fixed version, or remove it when the image does not need it. When no fix is released and the image never runs the vulnerable code, add a reviewed [OpenVEX statement]({VEX_GUIDE}). Never raise the budget. [CI troubleshooting]({TROUBLESHOOTING}) has the steps.']
    if rest:
        lines += ['', f'<details><summary>{len(rest)} other finding(s) within the budget</summary>', '', *findings_table(rest), '', '</details>']
    lines += ['', f'{suppressed} finding(s) left out by reviewed OpenVEX statements.', '']
    return lines


def main(report_path, budgets_path, image, reference, output_path):
    with open(budgets_path, encoding='utf-8') as handle:
        budget = budget_for(yaml.safe_load(handle) or {}, image)
    with open(report_path, encoding='utf-8') as handle:
        report = json.load(handle)
    all_findings = findings(report)
    found = Counter(finding['severity'] for finding in all_findings)
    over = verdict(budget, found)
    predicate = {
        'image': image,
        'reference': reference,
        'scanner': {'name': 'grype', 'version': (report.get('descriptor') or {}).get('version', '')},
        'budget': {key: budget[key] for key in ['mode', *SEVERITIES] if key in budget},
        'found': {severity: found.get(severity, 0) for severity in SEVERITIES},
        'suppressedByVex': len(report.get('ignoredMatches', [])),
        'met': not over,
    }
    with open(output_path, 'w', encoding='utf-8') as handle:
        json.dump(predicate, handle, indent=2)
    lines = summary_lines(image, reference, predicate['scanner']['version'], budget, found, over, all_findings, predicate['suppressedByVex'])
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as handle:
            handle.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    named = '; '.join(short(finding) for finding in all_findings if finding['severity'] in over)
    totals = ', '.join(f'{count} {severity}' for severity, count in over.items())
    if over and budget['mode'] == 'enforce':
        print(f'::error title=CVE budget: {image}::{image} is over its CVE budget: {totals} ({named})')
        return 1
    if over:
        print(f'::warning title=CVE budget: {image}::{image} is over its CVE budget, which only reports: {totals} ({named})')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(*sys.argv[1:6]))
    except (OSError, ValueError, KeyError, json.JSONDecodeError, yaml.YAMLError) as error:
        print(f'::error::The CVE gate could not reach a verdict: {error}. This is not a pass.')
        sys.exit(2)
