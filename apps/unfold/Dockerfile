ARG REGISTRY_CHAINGUARD=cgr.dev
# renovate: datasource=docker depName=cgr.dev/chainguard/wolfi-base versioning=docker
ARG WOLFI_BASE_IMAGE=${REGISTRY_CHAINGUARD}/chainguard/wolfi-base:latest@sha256:2c12da5496e21e99003b3db3b9246f025e53d533c4df334205391260f1e8f85b

FROM ${WOLFI_BASE_IMAGE} AS node
RUN printf 'https://packages.wolfi.dev/os\n' > /etc/apk/repositories \
 && apk upgrade --no-cache \
 && apk add --no-cache nodejs-24 npm \
 && node --version | grep -q '^v24\.' \
 && addgroup -g 1000 node \
 && adduser -D -u 1000 -G node -h /home/node -s /sbin/nologin node

FROM node AS stage
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY examples ./examples
COPY scripts ./scripts
COPY docs/contracts/openapi.yaml ./docs/contracts/openapi.yaml
COPY docs/contracts/config.v1.schema.json ./docs/contracts/config.v1.schema.json
ARG IMAGE_VERSION=dev
RUN if [ "${IMAGE_VERSION}" != dev ]; then node scripts/stamp-version.mjs "${IMAGE_VERSION}" app; fi
RUN install -d -o node -g node -m 0700 /data && install -d /app/.node-cache && chown -R node:node /app

FROM ${WOLFI_BASE_IMAGE} AS rootfs
RUN printf 'https://packages.wolfi.dev/os\n' > /etc/apk/repositories \
 && apk add --no-cache --no-scripts --root /rootfs --initdb --keys-dir /etc/apk/keys --repositories-file /etc/apk/repositories \
      wolfi-baselayout ca-certificates-bundle nodejs-24 git \
 && rm -rf /rootfs/var/cache/apk /rootfs/etc/apk/repositories /rootfs/usr/libexec/git-core/git-http-push \
 && printf 'node:x:1000:1000:node:/home/node:/sbin/nologin\n' >> /rootfs/etc/passwd \
 && printf 'node:x:1000:\n' >> /rootfs/etc/group \
 && install -d -o 1000 -g 1000 -m 0750 /rootfs/home/node \
 && install -d -m 1777 /rootfs/tmp \
 && chroot /rootfs /usr/bin/git --version \
 && chroot /rootfs /usr/bin/node --version | grep -q '^v24\.'

FROM scratch AS app
ARG IMAGE_CREATED=1970-01-01T00:00:00Z
ARG IMAGE_VERSION=dev
ARG IMAGE_REVISION=unknown
COPY --from=rootfs /rootfs/ /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COPY --from=stage --chown=1000:1000 /app /app
COPY --from=stage --chown=1000:1000 /data /data
RUN ["git", "--version"]
WORKDIR /app
ENV UNFOLD_HOST=0.0.0.0 UNFOLD_PORT=4080 UNFOLD_DATA_DIR=/data
EXPOSE 4080
USER node
ENV NODE_COMPILE_CACHE=/app/.node-cache
RUN ["node", "--input-type=module", "-e", "await import('/app/src/main.ts'); const { flushCompileCache, getCompileCacheDir } = await import('node:module'); flushCompileCache(); const { readdirSync } = await import('node:fs'); const written = getCompileCacheDir() ? readdirSync(getCompileCacheDir()).length : 0; if (written < 50) throw new Error('NODE_COMPILE_CACHE wrote ' + written + ' entries; expected one per application module');"]
LABEL org.opencontainers.image.title="Unfold" \
    org.opencontainers.image.description="Operator workbench control plane: shell-less Wolfi Node runtime with no package manager, plus git for governed delivery; agent work runs in separate workspaces." \
    org.opencontainers.image.source="https://github.com/unfold-hq/unfold" \
    org.opencontainers.image.vendor="Unfold" \
    org.opencontainers.image.licenses="Apache-2.0" \
    org.opencontainers.image.created="${IMAGE_CREATED}" \
    org.opencontainers.image.version="${IMAGE_VERSION}" \
    org.opencontainers.image.revision="${IMAGE_REVISION}"
CMD ["node", "src/main.ts"]
