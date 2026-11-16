import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import release_preflight  # noqa: E402


HOME_STATE = {'full_name': 'unfold-hq/unfold', 'default_branch': 'development', 'private': False}


class GitHubHome(unittest.TestCase):
    def test_a_redirect_from_the_former_name_is_not_a_repository_of_its_own(self):
        for state, returned in [(None, False), ({'full_name': 'unfold-hq/unfold'}, False), ({'full_name': 'webgrip/unfold'}, True)]:
            with self.subTest(state=state):
                self.assertEqual(release_preflight.former_home_returned(lambda url: state), returned)

    def run_main(self, home, former=None):
        def api(url, token, method='GET', data=None, missing=False):
            if url == release_preflight.HOME:
                return home
            if url == 'https://api.github.com/repos/webgrip/unfold':
                return former
            raise AssertionError('reached the trunk comparison')

        def git(*args, **kwargs):
            raise AssertionError('reached the trunk comparison')

        with patch.dict('os.environ', {'GITHUB_TOKEN': 'token', 'GITHUB_ACTOR': 'actor'}, clear=True), patch.object(release_preflight, 'api', api), patch.object(release_preflight, 'git', git):
            release_preflight.main()

    def test_a_github_rename_redirect_is_not_accepted_as_the_project_home(self):
        with self.assertRaisesRegex(RuntimeError, 'GitHub repository identity: expected unfold-hq/unfold, got unfold-hq/renamed'):
            self.run_main({**HOME_STATE, 'full_name': 'unfold-hq/renamed'})

    def test_a_private_home_or_another_trunk_stops_the_preflight(self):
        for change, message in [({'private': True}, 'GitHub visibility'), ({'default_branch': 'main'}, 'GitHub trunk')]:
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, message):
                self.run_main({**HOME_STATE, **change})

    def test_a_recreated_former_repository_stops_the_preflight(self):
        with self.assertRaisesRegex(RuntimeError, 'webgrip/unfold exists again'):
            self.run_main(HOME_STATE, {'full_name': 'webgrip/unfold'})

    def test_the_home_and_a_redirecting_former_name_reach_the_trunk_comparison(self):
        for former in [None, {'full_name': 'unfold-hq/unfold'}]:
            with self.subTest(former=former), self.assertRaisesRegex(AssertionError, 'reached the trunk comparison'):
                self.run_main(HOME_STATE, former)


if __name__ == '__main__':
    unittest.main()
