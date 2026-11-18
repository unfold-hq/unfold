ARG REGISTRY_CHAINGUARD=cgr.dev
# renovate: datasource=docker depName=cgr.dev/chainguard/wolfi-base versioning=docker
ARG WOLFI_BASE_IMAGE=${REGISTRY_CHAINGUARD}/chainguard/wolfi-base:latest@sha256:2c12da5496e21e99003b3db3b9246f025e53d533c4df334205391260f1e8f85b
# renovate: datasource=npm depName=opencode-ai
ARG OPENCODE_VERSION=1.19.5
# renovate: datasource=npm depName=brace-expansion
ARG NPM_BRACE_EXPANSION_VERSION=5.0.12
# renovate: datasource=npm depName=undici
ARG NPM_UNDICI_VERSION=6.29.1

FROM ${WOLFI_BASE_IMAGE} AS node
RUN printf 'https://packages.wolfi.dev/os\n' > /etc/apk/repositories \
 && apk upgrade --no-cache \
 && apk add --no-cache nodejs-24 npm \
 && node --version | grep -q '^v24\.' \
 && addgroup -g 1000 node \
 && adduser -D -u 1000 -G node -h /home/node -s /bin/bash node

FROM node AS fetch
ARG OPENCODE_VERSION
ARG NPM_BRACE_EXPANSION_VERSION
ARG NPM_UNDICI_VERSION
ARG TARGETARCH
WORKDIR /tmp/opencode
RUN case "${TARGETARCH}" in amd64) platform=x64 ;; arm64) platform=arm64 ;; *) echo "unsupported TARGETARCH ${TARGETARCH}" >&2; exit 1 ;; esac \
 && npm pack --quiet "opencode-linux-${platform}@${OPENCODE_VERSION}" \
 && tar -xzf "opencode-linux-${platform}-${OPENCODE_VERSION}.tgz" \
 && install -m 0755 package/bin/opencode /opencode \
 && /opencode --version
WORKDIR /npm-patches
RUN for spec in "brace-expansion@${NPM_BRACE_EXPANSION_VERSION}" "undici@${NPM_UNDICI_VERSION}"; do \
      name="${spec%@*}" && npm pack --quiet "${spec}" && install -d "${name}" && tar -xzf "${name}-${spec##*@}.tgz" -C "${name}" --strip-components=1 && rm "${name}-${spec##*@}.tgz"; \
    done

FROM node
ARG OPENCODE_VERSION
ARG IMAGE_CREATED=1970-01-01T00:00:00Z
ARG IMAGE_VERSION=dev
ARG IMAGE_REVISION=unknown
RUN apk add --no-cache bash git ca-certificates-bundle ripgrep \
 && rm /usr/libexec/git-core/git-http-push \
 && rm -rf /usr/lib/node_modules/node-gyp /usr/bin/node-gyp \
 && ! command -v node-gyp \
 && install -d -o node -g node -m 0755 /workspace /etc/opencode
COPY --from=fetch /opencode /usr/local/bin/opencode
RUN install -d -m 0755 /usr/local/lib/unfold
COPY relay-worker.mjs /usr/local/lib/unfold/relay-worker.mjs
RUN chmod 0644 /usr/local/lib/unfold/relay-worker.mjs
RUN --mount=type=bind,from=fetch,source=/npm-patches,target=/tmp/npm-patches \
    --mount=type=bind,source=patch-bundled-npm.mjs,target=/tmp/patch-bundled-npm.mjs \
    node /tmp/patch-bundled-npm.mjs /tmp/npm-patches
RUN --mount=type=bind,source=check-picomatch-users.mjs,target=/tmp/check-picomatch-users.mjs node /tmp/check-picomatch-users.mjs
USER node
RUN node --check /usr/local/lib/unfold/relay-worker.mjs
RUN opencode --version | grep -F "${OPENCODE_VERSION}"
WORKDIR /workspace
EXPOSE 4096
ENV OPENCODE_DISABLE_AUTOUPDATE=true OPENCODE_DISABLE_SHARE=true
LABEL org.opencontainers.image.title="Unfold agent workspace" \
    org.opencontainers.image.description="OpenCode ${OPENCODE_VERSION} server for one Unfold session: Wolfi base, git, bash, node; no package manager network at run time." \
    org.opencontainers.image.source="https://github.com/unfold-hq/unfold" \
    org.opencontainers.image.vendor="Unfold" \
    org.opencontainers.image.licenses="Apache-2.0" \
    org.opencontainers.image.created="${IMAGE_CREATED}" \
    org.opencontainers.image.version="${IMAGE_VERSION}" \
    org.opencontainers.image.revision="${IMAGE_REVISION}"
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
