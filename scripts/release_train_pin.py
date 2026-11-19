import json
import os
import re
import sys
import urllib.error
import urllib.request

PIN_BRANCH = re.compile(r'^ploeg/(?P<core>(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))(?:-(?P<pre>[0-9A-Za-z.-]+))?$')
PAGE = 50


class PinMergeError(Exception):
    pass


def precedence(version):
    match = PIN_BRANCH.match(f'ploeg/{version}')
    core = tuple(int(part) for part in match['core'].split('.'))
    if match['pre'] is None:
        return core, (1,)
    identifiers = tuple((0, int(part), '') if part.isdigit() else (1, 0, part) for part in match['pre'].split('.'))
    return core, (0, identifiers)


def pin_version(pull, repository, base, author):
    match = PIN_BRANCH.match(pull['head']['ref'])
    if not match or pull['base']['ref'] != base or pull['user']['login'] != author:
        return None
    if (pull['head'].get('repo') or {}).get('full_name') != repository:
        return None
    return pull['head']['ref'].removeprefix('ploeg/')


def pin_pulls(pulls, repository, base, author):
    found = [(version, pull) for pull in pulls if (version := pin_version(pull, repository, base, author))]
    return sorted(found, key=lambda item: precedence(item[0]), reverse=True)


class GitHub:
    def __init__(self, api, token, graphql='https://api.github.com/graphql'):
        self.api = api.rstrip('/')
        self.graphql = graphql
        self.token = token

    def call(self, method, url, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url, data=data, method=method, headers={'Accept': 'application/vnd.github+json', 'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json', 'User-Agent': 'unfold-ploeg-pin', 'X-GitHub-Api-Version': '2022-11-28'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read()
                return response.status, json.loads(payload) if payload.strip() else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors='replace')[:500]
            error.close()
            return error.code, detail
        except urllib.error.URLError as error:
            raise PinMergeError(f'{method} {url} is unreachable: {error.reason}') from error

    def expect(self, method, path, body=None):
        status, payload = self.call(method, f'{self.api}{path}', body)
        if status not in (200, 201, 204):
            raise PinMergeError(f'{method} {path} answered HTTP {status}: {payload}')
        return payload

    def open_pulls(self, base):
        pulls, page = [], 1
        while True:
            batch = self.expect('GET', f'/pulls?state=open&base={base}&per_page={PAGE}&page={page}') or []
            pulls.extend(batch)
            if len(batch) < PAGE:
                return pulls
            page += 1

    def auto_merge(self, pull):
        mutation = 'mutation($id: ID!, $head: GitObjectID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: MERGE, expectedHeadOid: $head}) { clientMutationId } }'
        status, payload = self.call('POST', self.graphql, {'query': mutation, 'variables': {'id': pull['node_id'], 'head': pull['head']['sha']}})
        errors = payload.get('errors') if isinstance(payload, dict) else [{'message': str(payload)}]
        if status == 200 and not errors:
            return 'armed'
        if any('clean status' in str(error.get('message', '')) for error in errors or []):
            return self.enqueue(pull)
        raise PinMergeError(f'enabling auto-merge on #{pull["number"]} answered HTTP {status}: {errors or payload}')

    def enqueue(self, pull):
        mutation = 'mutation($id: ID!, $head: GitObjectID!) { enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $head}) { mergeQueueEntry { id } } }'
        status, payload = self.call('POST', self.graphql, {'query': mutation, 'variables': {'id': pull['node_id'], 'head': pull['head']['sha']}})
        errors = payload.get('errors') if isinstance(payload, dict) else [{'message': str(payload)}]
        if status == 200 and not errors:
            return 'queued'
        raise PinMergeError(f'adding #{pull["number"]} to the merge queue answered HTTP {status}: {errors or payload}')

    def close(self, number, comment):
        self.expect('POST', f'/issues/{number}/comments', {'body': comment})
        self.expect('PATCH', f'/pulls/{number}', {'state': 'closed'})


def arm_newest_pin(forge, repository, base, author, log=print):
    candidates = pin_pulls(forge.open_pulls(base), repository, base, author)
    if not candidates:
        log(f'No open Ploeg pin pull request from {author} into {base}.')
        return None
    (version, pull), older = candidates[0], candidates[1:]
    outcome = forge.auto_merge(pull)
    log(f'#{pull["number"]} (Ploeg {version}) {"merges as soon as its required checks pass" if outcome == "armed" else "was already green and joined the merge queue"}.')
    for superseded, other in older:
        forge.close(other['number'], f'Superseded by #{pull["number"]} (Ploeg {version}), which merges on its own once its checks pass.')
        log(f'Closed #{other["number"]} (Ploeg {superseded}), superseded by #{pull["number"]}.')
    return pull['number']


def emit(name, value):
    print(f'{name}={value}')
    output = os.environ.get('GITHUB_OUTPUT')
    if output:
        with open(output, 'a') as handle:
            handle.write(f'{name}={value}\n')


def main():
    try:
        number = arm_newest_pin(GitHub(os.environ['GITHUB_REPOSITORY_API'], os.environ['PIN_MERGE_TOKEN']), os.environ['REPOSITORY'], os.environ['PIN_BASE'], os.environ['PIN_AUTHOR'])
    except PinMergeError as error:
        sys.exit(f'release train pin: {error}')
    emit('armed', number or '')


if __name__ == '__main__':
    main()
