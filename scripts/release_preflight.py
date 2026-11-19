import base64
import json
import os

from publish_release import HOME, HOME_NAMESPACE, HOME_REGISTRY, HOME_REPOSITORY, api, extension_identity, git
from release_registry import Registry, request, require_same


FORMER_HOME = 'webgrip/unfold'


def former_home_returned(read):
    state = read(f'https://api.github.com/repos/{FORMER_HOME}')
    return state is not None and state.get('full_name') == FORMER_HOME


def marketplace_publisher_exists(publisher, read=request):
    page, _ = read(f'https://marketplace.visualstudio.com/publishers/{publisher}', missing=True)
    return page is not None


def github_identity(environ=os.environ):
    url = environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    url += ('&' if '?' in url else '?') + 'audience=sigstore'
    data, _ = request(url, headers={'Authorization': 'Bearer ' + environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    payload = json.loads(data)['value'].split('.')[1]
    return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))


def main():
    token = os.environ['GITHUB_TOKEN']
    repo = api(HOME, token)
    require_same(repo['full_name'], HOME_REPOSITORY, 'GitHub repository identity')
    require_same(repo['default_branch'], 'development', 'GitHub trunk')
    require_same(repo['private'], False, 'GitHub visibility')
    print(f'GitHub answers as {HOME_REPOSITORY} directly, public, with development as trunk')
    if former_home_returned(lambda url: api(url, token, missing=True)):
        raise RuntimeError(f'{FORMER_HOME} exists again as a repository of its own; only a redirect to {HOME_REPOSITORY} may answer under that name')
    print(f'{FORMER_HOME} is not a repository of its own')
    require_same(git('rev-parse', 'HEAD'), git('ls-remote', 'origin', 'refs/heads/development').split()[0], 'GitHub trunk head')
    registry = Registry(HOME_REGISTRY, os.environ['GITHUB_ACTOR'], token)
    for name in ['unfold', 'unfold-agent', 'charts/unfold']:
        registry.headers(f'{HOME_NAMESPACE}/{name}', 'pull,push')
    print(f'{HOME_REGISTRY}/{HOME_NAMESPACE}: registry authentication passed')
    namespace, name = extension_identity()
    if api(f'https://open-vsx.org/api/{namespace}', '', missing=True) is None:
        raise RuntimeError(f'Open VSX has no namespace {namespace} to publish {namespace}.{name} into')
    print(f'Open VSX namespace {namespace} exists')
    if not marketplace_publisher_exists(namespace):
        raise RuntimeError(f'The Visual Studio Marketplace has no publisher {namespace} to publish {namespace}.{name} into')
    print(f'Visual Studio Marketplace publisher {namespace} exists')
    claims = github_identity()
    require_same(claims['repository'], HOME_REPOSITORY, 'signing identity')
    print('GitHub Actions OIDC identity for keyless signing passed')


if __name__ == '__main__':
    main()
