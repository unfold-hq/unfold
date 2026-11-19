import datetime
import html
import re
import unicodedata
from urllib.parse import unquote, urlsplit

import yaml

HISTORY_PARTS = {'research', 'evidence', 'adr', 'adrs', 'design', 'openspec'}
PARKED_PARTS = {'brand'}
CURRENT_POLICY_PAGES = {'TRADEMARK'}
HISTORY_PREFIXES = (
    'landscape/bottlenecks',
    'landscape/c4',
    'landscape/components',
    'landscape/index',
    'migration-proposal',
    'unfold/PRODUCT-DESIGN',
    'unfold/contracts/implementation',
    'unfold/operations/backlog',
    'unfold/operations/implementation-progress',
    'unfold/operations/iteration-',
    'unfold/product/go-to-market',
    'ploeg/backlog',
    'ploeg/history',
)
PINNED_PREFIXES = ('ploeg/',)
REMOVED_FROM_TREE = {
    '.forgejo/': 'c19fdd492b9c866607b6adbca933f1b597b7b86c',
    'scripts/restore_extension_asset.py': 'c19fdd492b9c866607b6adbca933f1b597b7b86c',
    'scripts/sign_extension_asset.py': 'c19fdd492b9c866607b6adbca933f1b597b7b86c',
    'scripts/workflow-policy.test.cjs': 'c19fdd492b9c866607b6adbca933f1b597b7b86c',
}
FENCE = re.compile(r'^[ \t]*(`{3,}|~{3,})[^\n]*\n.*?^[ \t]*\1[^\n]*$', re.M | re.S)
FRONT_MATTER = re.compile(r'\A---\n(.*?\n)?---\n', re.S)
DATE = re.compile(r'(\d{4}-\d{2}-\d{2})')


def historical(location):
    """Return whether a published path is a record rather than current guidance.

    Accepts staged Markdown paths, site locations and search-index locations.
    """
    path = unquote(urlsplit(location).path).lstrip('/')
    if path.startswith(HISTORY_PREFIXES):
        return True
    page = re.sub(r'(/|/index\.html|\.html|\.md)$', '', path)
    parts = [part for part in page.split('/') if part]
    if parts and parts[-1] in {'index', 'README'}:
        parts.pop()
        if parts and parts[-1] in {'adr', 'adrs'}:
            return False
    elif parts and parts[-1] in {'adr', 'adrs'} and not path.endswith('.md'):
        return False
    if any(part in PARKED_PARTS for part in parts) and parts[-1] not in CURRENT_POLICY_PAGES:
        return True
    return any(part in HISTORY_PARTS for part in parts)


def removed_revision(path):
    """Return the last commit that held a repository path removed from the tree, or None.

    A record keeps its links as written; the build points one at a removed file to that commit.
    """
    for prefix, revision in REMOVED_FROM_TREE.items():
        if path == prefix.rstrip('/') or (prefix.endswith('/') and path.startswith(prefix)):
            return revision
    return None


def pinned(page):
    """Return whether a staged page is a pinned dependency's own documentation.

    Unfold renders those pages; the dependency's own checks own their links, reachability and front matter.
    """
    return page.startswith(PINNED_PREFIXES)


def slug(text):
    """Return the Python-Markdown toc slug for a heading's source text."""
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text.replace('`', '').replace('**', '').replace('*', ''))
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')
    text = re.sub(r'[^\w\s-]', '', text).strip().lower()
    return re.sub(r'[-\s]+', '-', text)


def anchors(markdown):
    """Return every fragment a rendered page accepts: heading slugs, attribute ids and HTML ids."""
    body = FENCE.sub('', FRONT_MATTER.sub('', markdown))
    found = set(re.findall(r'''\b(?:id|name)=["']([^"']+)["']''', body))
    counts = {}
    for heading in re.findall(r'^#{1,6}[ \t]+(.+?)[ \t#]*$', body, flags=re.M):
        explicit = re.search(r'\{[^}]*#([\w-]+)[^}]*\}\s*$', heading)
        if explicit:
            found.add(explicit[1])
            continue
        base = slug(heading)
        candidate = base
        while candidate in counts or candidate in found:
            counts[base] = counts.get(base, 0) + 1
            candidate = f'{base}_{counts[base]}'
        counts[candidate] = 0
        found.add(candidate)
    return {re.sub('-+', '-', anchor) for anchor in found}


def record_date(relative, markdown):
    """Return the most specific date a record carries, or None."""
    front = FRONT_MATTER.match(markdown)
    if front:
        match = re.search(r'^date:\s*["\']?(\d{4}-\d{2}-\d{2})', front[1] or '', re.M)
        if match:
            return match[1]
    match = DATE.search(relative.rsplit('/', 1)[-1]) or DATE.search(relative)
    if match:
        return match[1]
    match = re.search(r'^(?:\*\s*)?Date:\s*(\d{4}-\d{2}-\d{2})', markdown[:2000], re.M)
    return match[1] if match else None


def mark_history(markdown, relative):
    """Exclude a record from search and label it as history, leaving its content unchanged."""
    date = record_date(relative, markdown)
    banner = f'> Record from {date}; not current guidance.\n' if date else '> Record; not current guidance.\n'
    front = FRONT_MATTER.match(markdown)
    if front:
        header = front[1] or ''
        if not re.search(r'^search:', header, re.M):
            header += 'search:\n  exclude: true\n'
        body = markdown[front.end():]
    else:
        header, body = 'search:\n  exclude: true\n', markdown
    heading = re.search(r'^# .+\n', FENCE.sub(lambda m: '\n' * m[0].count('\n'), body), re.M)
    if heading and not body[:heading.start()].strip():
        body = body[:heading.end()] + '\n' + banner + ('' if body[heading.end():].startswith('\n') else '\n') + body[heading.end():]
    else:
        body = banner + '\n' + body
    return f'---\n{header}---\n{body}'


def nav_pages(nav):
    """Return the Markdown paths listed in a mkdocs nav tree."""
    if isinstance(nav, str):
        return {nav} if nav.endswith('.md') else set()
    if isinstance(nav, list):
        return set().union(*(nav_pages(item) for item in nav)) if nav else set()
    if isinstance(nav, dict):
        return set().union(*(nav_pages(item) for item in nav.values())) if nav else set()
    return set()


def orphans(pages, nav, links):
    """Return current pages that are neither in the nav nor linked from a nav page.

    `links` maps a staged page to the staged pages it links to.
    """
    reachable = set(nav)
    for page in nav:
        reachable |= links.get(page, set())
    return sorted(page for page in pages if not historical(page) and not pinned(page) and page not in reachable)


SOURCE_ROOTS = (('docs', ''), ('apps/unfold/docs', 'unfold'), ('apps/ploeg/docs', 'ploeg'))
PAGE_TYPES = {'landing', 'tutorial', 'how-to', 'explanation', 'reference'}
AUDIENCES = {'owner', 'operator', 'integrator', 'contributor', 'agent'}
OWNERS = {'unfold', 'ploeg', 'unfold'}
REQUIRED_FOLDERS = ('concepts/', 'how-to/', 'reference/')
STALE_DAYS = 180


def front_matter(markdown):
    """Return a page's YAML front matter as a mapping, or None when it has none."""
    front = FRONT_MATTER.match(markdown)
    if not front:
        return None
    data = yaml.safe_load(front[1] or '')
    return data if isinstance(data, dict) else None


def checked_pages(pages, nav):
    """Return the staged pages whose front matter is enforced.

    These are the current pages in the nav plus every current page under concepts/, how-to/ and reference/, except pinned ones.
    """
    return sorted(page for page in pages if page.endswith('.md') and not historical(page) and not pinned(page) and (page in nav or page.startswith(REQUIRED_FOLDERS)))


def front_matter_problems(markdown, today):
    """Return what is missing or invalid in a current page's front matter.

    A generated reference page names its generator in `generated_by` instead of carrying
    `last_verified`: its drift check re-verifies it on every run, so a date would only age.
    A page known to be out of date says why in `unverified` instead of carrying an invented date;
    the staleness report lists it until someone verifies the page.
    """
    try:
        meta = front_matter(markdown)
    except yaml.YAMLError:
        return ['front matter is not valid YAML']
    if meta is None:
        return ['no front matter']
    problems = []
    if meta.get('type') not in PAGE_TYPES:
        problems.append(f"type must be one of {', '.join(sorted(PAGE_TYPES))}")
    audience = meta.get('audience')
    if not isinstance(audience, list) or not audience or not set(map(str, audience)) <= AUDIENCES:
        problems.append(f"audience must be a non-empty list drawn from {', '.join(sorted(AUDIENCES))}")
    if meta.get('owner') not in OWNERS:
        problems.append(f"owner must be one of {', '.join(sorted(OWNERS))}")
    generated = isinstance(meta.get('generated_by'), str) and bool(meta['generated_by'].strip())
    if generated and meta.get('type') != 'reference':
        problems.append('generated_by is only for generated reference pages')
    unverified = isinstance(meta.get('unverified'), str) and bool(meta['unverified'].strip())
    verified = meta.get('last_verified')
    if unverified and (generated or verified is not None):
        problems.append('unverified excludes last_verified and generated_by')
    if verified is None:
        if not generated and not unverified:
            problems.append('last_verified is required unless the page is generated (generated_by) or states why it is unverified (unverified)')
    elif not isinstance(verified, datetime.date) or isinstance(verified, datetime.datetime):
        problems.append('last_verified must be a YYYY-MM-DD date')
    else:
        if verified > today + datetime.timedelta(days=1):
            problems.append('last_verified is in the future')
        if not (isinstance(meta.get('verified_by'), str) and meta['verified_by'].strip()):
            problems.append('verified_by must name the command, test or source read behind last_verified')
    return problems


def stale(pages, today, days=STALE_DAYS):
    """Return (page, last_verified, age in days) for each page verified more than `days` ago, oldest first.

    `pages` maps a page name to its Markdown.
    """
    found = []
    for page, markdown in pages.items():
        try:
            verified = (front_matter(markdown) or {}).get('last_verified')
        except yaml.YAMLError:
            continue
        if isinstance(verified, datetime.date) and not isinstance(verified, datetime.datetime) and (today - verified).days > days:
            found.append((page, verified, (today - verified).days))
    return sorted(found, key=lambda entry: (entry[1], entry[0]))


def unverified(pages):
    """Return (page, reason) for each page whose front matter says why it is unverified."""
    found = []
    for page, markdown in pages.items():
        try:
            reason = (front_matter(markdown) or {}).get('unverified')
        except yaml.YAMLError:
            continue
        if isinstance(reason, str) and reason.strip():
            found.append((page, reason.strip()))
    return sorted(found)


INTEGRATION_PLACEHOLDER = re.compile(r'\{\{\s*([a-z]+)(?:\.([a-z]+))?\s*\}\}')
INTEGRATION_CODE = re.compile(r'(^[ \t]*`{3,}[^\n]*\n.*?^[ \t]*`{3,}[^\n]*$|^[ \t]*~{3,}[^\n]*\n.*?^[ \t]*~{3,}[^\n]*$|`+[^`\n]*`+)', re.M | re.S)


CONNECTOR_METHODS = {'Authorizer': ('oauth',), 'Manifest': ('github_app_manifest', 'github_app_installation'), 'Prober': ('token',)}
PLACEHOLDER_PORTS = ('trackers', 'forges')


def placeholder_categories(data):
    categories = []
    for port in data['ports']:
        placeholder = port.get('placeholder')
        if not placeholder:
            continue
        fields = [field for field in placeholder['fields'] if field != 'name']
        choices = [{'id': adapter['id'], 'name': adapter['name'], **{field: adapter[field] for field in fields}} for adapter in port['adapters'] if all(field in adapter for field in fields)]
        categories.append({'id': placeholder['id'], 'label': placeholder['label'], 'fields': placeholder['fields'], 'choices': choices})
    return categories


def integration_categories(data):
    return {category['id']: category for category in placeholder_categories(data)}


def integration_hint(category, field):
    if field == 'name':
        names = [choice['name'] for choice in category['choices']]
        return ', '.join(names[:-1]) + ' or ' + names[-1] if len(names) > 1 else names[0]
    return ' · '.join(f"{choice['name']}: {choice[field]}" for choice in category['choices'])


def integration_text(category, field, value):
    return f'`{value}`' if category['fields'][field].get('code') else value


def integration_table(category):
    fields = list(category['fields'])
    header = '| ' + ' | '.join(category['fields'][field]['label'] for field in fields) + ' |'
    rows = ['| ' + ' | '.join(integration_text(category, field, choice[field]) for field in fields) + ' |' for choice in category['choices']]
    return '\n'.join([header, '| ' + ' | '.join('---' for _ in fields) + ' |', *rows])


def adapter_connection(adapter, vocabulary):
    parts = []
    if adapter.get('static'):
        parts.append(f"configuration: {adapter['static']}")
    if adapter.get('runtime'):
        parts.append('at runtime: ' + ', '.join(vocabulary['methods'][method] for method in adapter['runtime']))
    if adapter.get('planned'):
        parts.append('planned: ' + ', '.join(vocabulary['methods'][method] for method in adapter['planned']))
    return '; '.join(parts) or '-'


def catalogue_markdown(data, link):
    vocabulary = data['vocabulary']
    sections = []
    for port in data['ports']:
        intro = f"{vocabulary['kinds'][port['kind']]}. {port['description']}"
        if port.get('docs'):
            intro += ' See ' + ', '.join(link(path) for path in port['docs']) + '.'
        lines = [f"### {port['label']} {{ #port-{port['id']} }}", '', intro, '', '| Adapter | Status | Owner | What it does | How it connects | Mechanism | Docs |', '| --- | --- | --- | --- | --- | --- | --- |']
        for adapter in port['adapters']:
            cells = [
                adapter['name'],
                vocabulary['statuses'][adapter['status']],
                vocabulary['owners'][adapter['owner']],
                ', '.join(vocabulary['does'][job] for job in adapter['does']),
                adapter_connection(adapter, vocabulary),
                ', '.join(vocabulary['mechanisms'][mechanism] for mechanism in adapter['mechanisms']),
                ', '.join(link(path) for path in adapter.get('docs', [])) or '-',
            ]
            lines.append('| ' + ' | '.join(cell.replace('|', '\\|') for cell in cells) + ' |')
        sections.append('\n'.join(lines))
    return '\n\n'.join(sections)


def expand_integrations(markdown, data, reference_link, link=None):
    """Replace {{ category.table }} with a table of every integration, {{ catalogue.ports }} with a section per port, and {{ category.field }} outside code with the integration-neutral text, linked to the reference page with every integration's value as its hover text. Return (markdown, problems)."""
    categories = integration_categories(data)
    problems = []

    def placeholder(match):
        name, field = match[1], match[2] or 'name'
        if name == 'catalogue' and field == 'ports':
            return catalogue_markdown(data, link or (lambda path: f'`{path}`'))
        category = categories.get(name)
        if category is not None and field == 'table':
            return integration_table(category)
        if category is None or field not in category['fields']:
            problems.append(match[0])
            return match[0]
        text = integration_text(category, field, category['fields'][field]['any'])
        hint = integration_hint(category, field).replace('"', "'")
        return f'[{text}]({reference_link}#{name} "{hint}"){{ .unfold-choice data-choice="{name}.{field}" }}'

    chunks = INTEGRATION_CODE.split(markdown)
    for index in range(0, len(chunks), 2):
        chunks[index] = INTEGRATION_PLACEHOLDER.sub(placeholder, chunks[index])
    return ''.join(chunks), problems


def ploeg_integration_facts(provider_sources, methods_source, connectors_source, references_source, reference_sources):
    """Read what the pinned Ploeg serves from its Go sources: provider names, connection methods, the runtime connectors with the methods each serves, and the reference prefix of each tracker that names its own."""
    providers = set(re.findall(r'(?:Name\(\) string \{ return|const Name =) "([a-z]+)"', provider_sources))
    methods = set(re.findall(r'^\s*Method\w+\s*=\s*"([a-z_]+)"', methods_source, re.M))
    body = re.search(r'func connectors\(\)[^{]*\{(.*?)\n\}', connectors_source, re.S)
    connectors = {}
    for kind, fields in re.findall(r'^\s*"([a-z]+)":\s*\{(.*)\},?\s*$', body[1] if body else '', re.M):
        connectors[kind] = {method for capability, served in CONNECTOR_METHODS.items() if re.search(rf'\b{capability}:', fields) for method in served}
    references = {}
    for provider, package in re.findall(r'RegisterReferenceNamer\("([a-z]+)",\s*(\w+)\.Reference\)', references_source):
        prefix = re.search(r'func Reference\(externalID string\) string \{ return "([^"]*)" \+ externalID', reference_sources.get(package, ''))
        if prefix:
            references[provider] = prefix[1]
    return {'providers': providers, 'methods': methods, 'connectors': connectors, 'references': references}


def expected_reference(provider, references):
    if provider == 'vikunja':
        return 'agent/vik-', 'VIK-'
    prefix = references.get(provider, f'{provider}-')
    return f'agent/{prefix}', prefix


def adapter_problems(port, adapter, vocabulary, ploeg):
    where = f"{port['id']}.{adapter['id']}"
    problems = [f'{where}: unknown {key} {adapter.get(key)}' for key, allowed in [('status', 'statuses'), ('owner', 'owners')] if adapter.get(key) not in vocabulary[allowed]]
    for key, allowed in [('mechanisms', 'mechanisms'), ('does', 'does'), ('runtime', 'methods'), ('planned', 'methods')]:
        problems += [f'{where}: unknown {key} entry {entry}' for entry in adapter.get(key, []) if entry not in vocabulary[allowed]]
    if not adapter.get('mechanisms') or not adapter.get('does'):
        problems.append(f'{where}: needs mechanisms and does')
    provider = adapter.get('provider')
    if provider is None:
        return problems + ([f'{where}: connects at runtime but names no Ploeg provider'] if adapter.get('runtime') else [])
    if adapter.get('owner') != 'ploeg':
        problems.append(f'{where}: names a Ploeg provider but is not owned by Ploeg')
    if provider not in ploeg['providers']:
        problems.append(f'{where}: Ploeg has no provider named {provider}')
    served = ploeg['connectors'].get(provider, set())
    for method in adapter.get('runtime', []):
        if method not in ploeg['methods']:
            problems.append(f'{where}: Ploeg serves no connection method {method}; list it under planned')
        elif method not in served:
            problems.append(f"{where}: Ploeg's {provider} connector does not serve {method}")
    problems += [f'{where}: Ploeg serves {method} now; move it from planned to runtime' for method in adapter.get('planned', []) if method in ploeg['methods'] and method in served]
    fields = [field for field in port.get('placeholder', {}).get('fields', {}) if field != 'name']
    missing = [field for field in fields if field not in adapter]
    if missing:
        problems.append(f"{where}: missing {', '.join(missing)}")
    if port['id'] == 'trackers':
        branch, reference = expected_reference(provider, ploeg['references'])
        if 'branch' in fields and not adapter.get('branch', '').startswith(branch):
            problems.append(f"{where}: Ploeg names the branch {branch}<id>, not {adapter.get('branch')}")
        if 'reference' in fields and not adapter.get('reference', '').startswith(reference):
            problems.append(f"{where}: Ploeg's Reference() is {reference}<id>, not {adapter.get('reference')}")
    return problems


def integration_problems(data, ploeg):
    """Return why docs/integrations.yml disagrees with itself or with what the pinned Ploeg serves."""
    vocabulary = data['vocabulary']
    port_ids = [port['id'] for port in data['ports']]
    problems = [] if len(set(port_ids)) == len(port_ids) else ['ports: port ids repeat']
    named, connected = set(), set()
    for port in data['ports']:
        if port.get('kind') not in vocabulary['kinds']:
            problems.append(f"{port['id']}: unknown kind {port.get('kind')}")
        ids = [adapter['id'] for adapter in port['adapters']]
        if len(set(ids)) != len(ids):
            problems.append(f"{port['id']}: adapter ids repeat")
        for adapter in port['adapters']:
            problems += adapter_problems(port, adapter, vocabulary, ploeg)
            if adapter.get('provider') and port['id'] in PLACEHOLDER_PORTS:
                named.add(adapter['provider'])
                if adapter.get('runtime'):
                    connected.add(adapter['provider'])
    problems += [f'Ploeg connects {kind} at runtime, but no tracker or forge adapter lists its runtime methods' for kind in sorted(set(ploeg['connectors']) - connected)]
    problems += [f'Ploeg has a provider named {provider}, but no tracker or forge adapter names it' for provider in sorted(ploeg['providers'] - named)]
    standards = [standard['id'] for standard in data.get('standards', [])]
    if len(set(standards)) != len(standards):
        problems.append('standards: ids repeat')
    problems += [f"standards.{standard['id']}: unknown status {standard.get('status')}" for standard in data.get('standards', []) if standard.get('status') not in vocabulary['statuses']]
    return problems


def site_integrations(data):
    """The port board and the standards the marketing site renders, in catalogue order."""
    def adapter(entry):
        shown = {'label': entry['label']} if entry.get('label') else {'name': entry['name']}
        return {**shown, **({'note': entry['note']} if entry.get('note') else {}), 'status': entry['status']}

    return {
        'ports': [{'id': port['id'], 'kind': port['kind'], 'openSocket': port['openSocket'], 'adapters': [adapter(entry) for entry in port['adapters']]} for port in data['ports']],
        'standards': [{'id': standard['id'], 'name': standard['name'], 'status': standard['status']} for standard in data['standards']],
    }
