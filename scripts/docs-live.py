import argparse
import concurrent.futures
import importlib.util
import json
import re
import time
from http.client import HTTPException
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml

root = Path(__file__).resolve().parent.parent
USER_AGENT = 'unfold-docs-live-check (+https://github.com/unfold-hq/unfold)'


def read_url(url, attempts=6, pause=5.0):
    for attempt in range(1, attempts + 1):
        try:
            return read_once(url)
        except (ConnectionError, TimeoutError, URLError, HTTPException) as error:
            if isinstance(error, HTTPError) and error.code < 500 or attempt == attempts:
                raise
            time.sleep(pause * attempt)


def read_once(url):
    with urlopen(Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': USER_AGENT}), timeout=25) as response:
        assert response.status == 200, f'Unexpected response: {url} ({response.status})'
        assert response.url.rstrip('/') == url.rstrip('/'), f'Unexpected redirect: {url} -> {response.url}'
        return response.read()


def verify(base, staging, read=read_url, site_url=None):
    expected = json.loads((staging / 'docs-sources.json').read_text())
    manifest = json.loads(read(urljoin(base, 'docs-sources.json')))
    assert manifest == expected, 'Published sources do not match this checkout; check the publish gate and selected revision'
    pages = [item['path'] for item in expected['sources'] if item['path'].endswith('.md')]

    def check_page(name):
        assert read(urljoin(base, name)) == (staging / name).read_bytes(), f'Missing or stale Markdown: {name}'
        path = PurePosixPath(name)
        location = str(path.parent).strip('.') + '/' if path.name in ['index.md', 'README.md'] else name.removesuffix('.md') + '/'
        assert b'zensical-' in read(urljoin(base, location.lstrip('/'))), f'Missing Zensical page: {name}'
        if location.strip('/'):
            assert b'zensical-' in read(urljoin(base, location.strip('/'))), f'Broken slashless page: {name}'

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(check_page, pages))
    assert b'zensical-' in read(base.rstrip('/')), 'Broken slashless site root'
    index = read(urljoin(base, 'llms.txt')).decode()
    bundle = read(urljoin(base, 'llms-full.txt')).decode()
    assert expected['revision'] in bundle, 'Published reading bundle has a stale revision'
    links = re.findall(r'\]\(([^\s)]+)', index)
    assert links, 'The machine reading index is empty'
    published = site_url or yaml.safe_load((root / 'mkdocs.yml').read_text())['site_url']
    for target in links:
        served = base + target.removeprefix(published) if target.startswith(published) else target
        assert served.startswith(base), f'Machine index leaves the site: {target}'
        assert read(served), f'Machine index target is empty: {target}'
    spec = importlib.util.spec_from_file_location('docs_output', root / 'scripts/docs-output.py')
    output = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(output)
    schemas = output.published_schemas(staging, site_url or yaml.safe_load((root / 'mkdocs.yml').read_text())['site_url'])
    for location in schemas:
        assert read(urljoin(base, location)) == (staging / location).read_bytes(), f'Missing or stale schema at its $id: {location}'
    search = json.loads(read(urljoin(base, 'search.json')))
    assert search['items'] and not any(output.historical(item['location']) for item in search['items']), 'Published search includes history or is empty'
    pagefind = json.loads(read(urljoin(base, 'pagefind/pagefind-entry.json')))
    count = sum(language['page_count'] for language in pagefind['languages'].values())
    assert count == sum(not output.historical(page) for page in pages), 'Pagefind page count disagrees with the maintained reading scope'
    return {'revision': expected['revision'], 'human_pages': len(pages), 'markdown_pages': len(pages), 'source_hashes': len(manifest['sources']), 'machine_index_links': len(links), 'schemas': len(schemas), 'pagefind_pages': count}


def verify_settled(base, staging, read=read_url, site_url=None, settle_seconds=300, pause=15.0, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + settle_seconds
    while True:
        try:
            return verify(base, staging, read, site_url)
        except AssertionError:
            if clock() + pause > deadline:
                raise
            sleep(pause)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', help='published site to check; defaults to site_url in mkdocs.yml')
    args = parser.parse_args()
    base = args.base or yaml.safe_load((root / 'mkdocs.yml').read_text())['site_url']
    print(json.dumps(verify_settled(base, root / '.build/docs')))
