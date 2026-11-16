import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import release_train_pin  # noqa: E402

REPOSITORY = 'unfold-hq/unfold'
BOT = 'unfold-hq-bot[bot]'


def pull(number, ref, author=BOT, base='development', repository=REPOSITORY):
    return {'number': number, 'head': {'ref': ref, 'sha': f'sha{number}', 'repo': {'full_name': repository}}, 'base': {'ref': base}, 'user': {'login': author}}


class PinOrdering(unittest.TestCase):
    def test_versions_order_by_semantic_precedence(self):
        versions = ['0.2.0-rc.9', '0.2.0', '0.2.0-rc.10', '0.3.0-rc.1', '0.2.0-beta.2', '0.10.0-rc.1']
        self.assertEqual(sorted(versions, key=release_train_pin.precedence), ['0.2.0-beta.2', '0.2.0-rc.9', '0.2.0-rc.10', '0.2.0', '0.3.0-rc.1', '0.10.0-rc.1'])

    def test_only_the_bots_pin_branches_into_the_base_from_this_repository_count(self):
        pulls = [
            pull(1, 'ploeg/0.2.0-rc.63'),
            pull(2, 'ploeg/0.2.0-rc.64', author='someone'),
            pull(3, 'ploeg/0.2.0-rc.64', base='main'),
            pull(4, 'ploeg/0.2.0-rc.64', repository='someone/unfold'),
            pull(5, 'feat/ploeg/0.2.0-rc.64'),
            pull(6, 'ploeg/by-hand'),
            pull(7, 'ploeg/0.2.0-rc.64'),
        ]
        self.assertEqual([item['number'] for _, item in release_train_pin.pin_pulls(pulls, REPOSITORY, 'development', BOT)], [7, 1])


class FakeGitHub:
    def __init__(self, pulls, outcome='armed'):
        self.pulls = pulls
        self.outcome = outcome
        self.armed = []
        self.closed = []

    def open_pulls(self, base):
        return [item for item in self.pulls if item['base']['ref'] == base]

    def auto_merge(self, pull):
        self.armed.append(pull['number'])
        return self.outcome

    def close(self, number, comment):
        self.closed.append((number, comment))


class ArmNewestPin(unittest.TestCase):
    def arm(self, forge):
        return release_train_pin.arm_newest_pin(forge, REPOSITORY, 'development', BOT, log=lambda _: None)

    def test_nothing_waiting_arms_nothing(self):
        forge = FakeGitHub([pull(3, 'ploeg/0.2.0-rc.70', author='someone', repository=REPOSITORY)])
        self.assertIsNone(self.arm(forge))
        self.assertEqual((forge.armed, forge.closed), ([], []))

    def test_the_newest_pin_gets_auto_merge_and_every_older_pin_closes(self):
        forge = FakeGitHub([pull(n, f'ploeg/0.2.0-rc.{n}', author=BOT, repository=REPOSITORY) for n in (69, 71, 70)])
        self.assertEqual(self.arm(forge), 71)
        self.assertEqual(forge.armed, [71])
        self.assertEqual([number for number, _ in forge.closed], [70, 69])
        self.assertTrue(all('Superseded by #71' in comment for _, comment in forge.closed))

    def test_a_pin_from_a_fork_or_another_author_is_never_armed(self):
        forge = FakeGitHub([pull(5, 'ploeg/0.3.0-rc.1', author=BOT, repository='someone/unfold'), pull(4, 'ploeg/0.2.0-rc.1', author=BOT, repository=REPOSITORY)])
        self.assertEqual(self.arm(forge), 4)
        self.assertEqual(forge.armed, [4])


class GitHubClient(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.graphql_answer = (200, {'data': {'enablePullRequestAutoMerge': {'clientMutationId': None}}})
        state = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def answer(self, method):
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                state.requests.append((method, self.path, self.headers.get('Authorization'), body))
                if self.path == '/graphql':
                    status, payload = state.graphql_answer
                elif method == 'GET':
                    page = int(self.path.rsplit('page=', 1)[1])
                    payload = [pull(n, f'ploeg/0.2.0-rc.{n}') for n in range(1, 51)] if page == 1 else []
                    status = 200
                else:
                    status, payload = 200, {}
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                self.answer('GET')

            def do_POST(self):
                self.answer('POST')

            def do_PATCH(self):
                self.answer('PATCH')

            def do_PUT(self):
                self.answer('PUT')

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{self.server.server_address[1]}'
        self.forge = release_train_pin.GitHub(f'{base}/repos/{REPOSITORY}/', 'app-token', graphql=f'{base}/graphql')
        self.pin = {'number': 9, 'node_id': 'PR_node9', 'head': {'sha': 'abc'}}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_the_client_pages_open_pulls_into_the_base_and_sends_the_token(self):
        self.assertEqual(len(self.forge.open_pulls('development')), 50)
        self.assertEqual([path for _, path, _, _ in self.requests], [f'/repos/{REPOSITORY}/pulls?state=open&base=development&per_page=50&page=1', f'/repos/{REPOSITORY}/pulls?state=open&base=development&per_page=50&page=2'])
        self.assertTrue(all(token == 'Bearer app-token' for _, _, token, _ in self.requests))

    def test_auto_merge_is_enabled_as_a_merge_commit_at_the_inspected_head(self):
        self.assertEqual(self.forge.auto_merge(self.pin), 'armed')
        method, path, _, body = self.requests[-1]
        self.assertEqual((method, path, body['variables']), ('POST', '/graphql', {'id': 'PR_node9', 'head': 'abc'}))
        self.assertIn('mergeMethod: MERGE', body['query'])

    def test_a_pin_that_is_already_green_merges_at_its_head_instead(self):
        self.graphql_answer = (200, {'errors': [{'message': 'Pull request Pull request is in clean status'}]})
        self.assertEqual(self.forge.auto_merge(self.pin), 'merged')
        self.assertEqual(self.requests[-1][::3], ('PUT', {'merge_method': 'merge', 'sha': 'abc'}))
        self.assertEqual(self.requests[-1][1], f'/repos/{REPOSITORY}/pulls/9/merge')

    def test_any_other_refusal_fails(self):
        self.graphql_answer = (200, {'errors': [{'message': 'Auto merge is not allowed for this repository'}]})
        with self.assertRaisesRegex(release_train_pin.PinMergeError, 'not allowed'):
            self.forge.auto_merge(self.pin)

    def test_the_client_comments_before_it_closes(self):
        self.forge.close(8, 'Superseded by #9.')
        self.assertEqual([(method, path, body) for method, path, _, body in self.requests], [
            ('POST', f'/repos/{REPOSITORY}/issues/8/comments', {'body': 'Superseded by #9.'}),
            ('PATCH', f'/repos/{REPOSITORY}/pulls/8', {'state': 'closed'}),
        ])


if __name__ == '__main__':
    unittest.main()
