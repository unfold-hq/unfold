import importlib.util
import json
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('openspec-skills.py')
spec = importlib.util.spec_from_file_location('openspec_skills', SCRIPT)
openspec_skills = importlib.util.module_from_spec(spec)
spec.loader.exec_module(openspec_skills)

FAKE_OPENSPEC = '''#!/usr/bin/env python3
import os, pathlib, shutil, sys
config = pathlib.Path(os.environ['XDG_CONFIG_HOME']) / 'openspec' / 'config.json'
shutil.copy(config, pathlib.Path(sys.argv[0]).with_name('seen-config.json'))
skill = pathlib.Path('.agents/skills/openspec-propose')
skill.mkdir(parents=True)
(skill / 'SKILL.md').write_text('generated')
'''


def executable(path, text):
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


class OpenSpecSkills(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.skills = self.root / 'skills'
        (self.skills / 'openspec-stale').mkdir(parents=True)
        (self.skills / 'openspec-stale' / 'SKILL.md').write_text('stale')
        (self.skills / 'investigate-session').mkdir()
        (self.skills / 'investigate-session' / 'SKILL.md').write_text('own')

    def test_replaces_only_the_openspec_skills(self):
        fake = executable(self.root / 'openspec', FAKE_OPENSPEC)
        self.assertEqual(openspec_skills.main(self.skills, fake), 0)
        self.assertEqual(sorted(path.name for path in self.skills.iterdir()), ['investigate-session', 'openspec-propose'])
        self.assertEqual((self.skills / 'openspec-propose' / 'SKILL.md').read_text(), 'generated')
        self.assertEqual((self.skills / 'investigate-session' / 'SKILL.md').read_text(), 'own')

    def test_ignores_the_persons_openspec_config(self):
        fake = executable(self.root / 'openspec', FAKE_OPENSPEC)
        openspec_skills.main(self.skills, fake)
        config = json.loads((self.root / 'seen-config.json').read_text())
        self.assertEqual(config, {'profile': 'core', 'delivery': 'skills'})

    def test_a_failed_generation_leaves_no_openspec_skill_so_agents_check_shows_it(self):
        fake = executable(self.root / 'openspec', '#!/bin/sh\nexit 1\n')
        with self.assertRaises(subprocess.CalledProcessError):
            openspec_skills.main(self.skills, fake)
        self.assertEqual([path.name for path in self.skills.iterdir()], ['investigate-session'])


if __name__ == '__main__':
    unittest.main()
