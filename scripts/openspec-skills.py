import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / '.apm' / 'skills'
PREFIX = 'openspec-'
OPENSPEC_CONFIG = {'profile': 'core', 'delivery': 'skills'}


def remove_generated(skills):
    for skill in skills.glob(PREFIX + '*'):
        shutil.rmtree(skill)


def generate(workdir, openspec):
    config_home = workdir / 'config'
    (config_home / 'openspec').mkdir(parents=True)
    (config_home / 'openspec' / 'config.json').write_text(json.dumps(OPENSPEC_CONFIG))
    project = workdir / 'project'
    project.mkdir()
    environment = {
        **os.environ,
        'XDG_CONFIG_HOME': str(config_home),
        'OPENSPEC_TELEMETRY': '0',
        'OPENSPEC_NO_UPDATE_CHECK': '1',
    }
    subprocess.run(
        [openspec, 'init', '--tools', 'agents', '--no-animation', '--no-copilot-cloud'],
        cwd=project,
        env=environment,
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
    )
    return sorted((project / '.agents' / 'skills').glob(PREFIX + '*'))


def main(skills=SKILLS, openspec='openspec'):
    remove_generated(skills)
    with tempfile.TemporaryDirectory() as workdir:
        generated = generate(Path(workdir), openspec)
        if not generated:
            print('openspec-skills: OpenSpec wrote no skills', file=sys.stderr)
            return 1
        for skill in generated:
            shutil.copytree(skill, skills / skill.name)
    print(f'openspec-skills: wrote {len(generated)} skills to {skills}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
