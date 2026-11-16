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


def integration_categories(data):
    return {category['id']: category for category in data['categories']}


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


def expand_integrations(markdown, data, reference_link):
    """Replace {{ category.table }} with a table of every integration, and {{ category.field }} outside code with the integration-neutral text, linked to the reference page with every integration's value as its hover text. Return (markdown, problems)."""
    categories = integration_categories(data)
    problems = []

    def placeholder(match):
        name, field = match[1], match[2] or 'name'
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


def integration_problems(data, provider_names):
    """Return why docs/integrations.yml disagrees with itself or with the Ploeg providers it names."""
    problems = []
    for category in data['categories']:
        for choice in category['choices']:
            missing = [field for field in category['fields'] if field not in choice]
            if missing:
                problems.append(f"{category['id']}.{choice['id']}: missing {', '.join(missing)}")
            if choice['id'] not in provider_names:
                problems.append(f"{category['id']}.{choice['id']}: Ploeg has no provider named {choice['id']}")
            if category['id'] == 'tracker':
                prefix = 'vik' if choice['id'] == 'vikunja' else choice['id']
                if 'branch' in category['fields'] and not choice.get('branch', '').startswith(f'agent/{prefix}-'):
                    problems.append(f"tracker.{choice['id']}: Ploeg names the branch agent/{prefix}-<id>, not {choice.get('branch')}")
                if 'reference' in category['fields'] and not choice.get('reference', '').startswith('VIK-' if prefix == 'vik' else f'{prefix}-'):
                    problems.append(f"tracker.{choice['id']}: reference {choice.get('reference')} does not match Ploeg's Reference()")
    return problems
