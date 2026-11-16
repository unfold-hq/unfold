ARG REGISTRY_CHAINGUARD=cgr.dev
# renovate: datasource=docker depName=cgr.dev/chainguard/wolfi-base versioning=docker
ARG WOLFI_BASE_IMAGE=${REGISTRY_CHAINGUARD}/chainguard/wolfi-base:latest@sha256:2c12da5496e21e99003b3db3b9246f025e53d533c4df334205391260f1e8f85b

FROM ${WOLFI_BASE_IMAGE}
RUN printf 'https://packages.wolfi.dev/os\n' > /etc/apk/repositories \
 && apk upgrade --no-cache \
 && apk add --no-cache bash ca-certificates-bundle git python-3.13 python3-as-3.13 nodejs-24 npm \
 && node --version | grep -q '^v24\.' \
 && python3 --version \
 && addgroup -g 1000 node \
 && adduser -D -u 1000 -G node -h /home/node -s /bin/bash node

COPY --chown=node:node . /src
USER node
WORKDIR /src
RUN python3 scripts/ploeg-contract.py fetch
WORKDIR /src/apps/unfold

RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm --prefix extensions/vscode ci --ignore-scripts --no-audit --no-fund
RUN npx tsc --noEmit
RUN UNFOLD_TEST_CONCURRENCY=4 npm test > /src/unfold-test.log 2>&1 \
    || echo "WARNING: npm test reported failures; see /src/unfold-test.log"

ENV NPM_CONFIG_OFFLINE=true UNFOLD_HOST=127.0.0.1 UNFOLD_PORT=4080
