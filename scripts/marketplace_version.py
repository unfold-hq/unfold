import re
import sys


CANDIDATE_SLOTS = 10000
PAUSED = 'the extension name unfold is taken on the Visual Studio Marketplace by another publisher, and Marketplace names are unique across publishers (ADR 0075)'
RELEASE = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
CANDIDATE = re.compile(RELEASE.pattern + r'-rc\.([1-9][0-9]*)')


def marketplace_version(version):
    if RELEASE.fullmatch(version):
        return version
    candidate = CANDIDATE.fullmatch(version)
    if candidate is None:
        raise ValueError(f'{version} is neither X.Y.Z nor X.Y.Z-rc.N')
    major, minor, patch, number = (int(part) for part in candidate.groups())
    if number >= CANDIDATE_SLOTS:
        raise ValueError(f'{version} does not fit the Marketplace version rule: the candidate number must stay below {CANDIDATE_SLOTS}')
    return f'{major}.{minor}.{(patch + 1) * CANDIDATE_SLOTS + number}'


if __name__ == '__main__':
    print(PAUSED if sys.argv[1] == '--paused' else marketplace_version(sys.argv[1]))
