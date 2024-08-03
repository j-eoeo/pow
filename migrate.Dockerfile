# syntax=docker/dockerfile:1.9.0@sha256:fe40cf4e92cd0c467be2cfc30657a680ae2398318afd50b0c80585784c604f28

# ベースとするイメージを定義
FROM ubuntu:devel@sha256:25895062172a2f39ae36da530f3db244b507d7ffb1c4dd42a3a487b5b446e996 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# jqのバイナリを取得する => /jq
FROM ghcr.io/jqlang/jq:1.7@sha256:12f998e5a6f3f6916f744ba6f01549f156f624b42f7564e67ec6dd4733973146 AS fetch-jq

# pnpmを取得する => /pnpm/
FROM quay.io/curl/curl-base:8.9.1@sha256:f0cbc0ff89a8336f7050f3739454ba3df8420572bfa3376eea463c38f504311d AS fetch-pnpm
ENV SHELL="sh"
ENV ENV="/tmp/env"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /dist
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,from=fetch-jq,source=/jq,target=/mounted-bin/jq \
    curl -fsSL --compressed https://get.pnpm.io/install.sh | env PNPM_VERSION=$(cat package.json  | /mounted-bin/jq -r .packageManager | grep -oE '[0-9]+\.[0-9]+\.[0-9]+') sh -

# .npmrcに設定を追記する => /_/.npmrc
FROM base AS change-npmrc
WORKDIR /_
COPY --link .npmrc ./
RUN echo "store-dir=/.pnpm-store" >> .npmrc

# Node.jsとdevDependenciesを取得する => /pnpm/,/.pnpm-store/,/_/node_modules/
FROM base AS fetch-deps
WORKDIR /_
COPY --link --from=fetch-pnpm /pnpm/ /pnpm/
ARG TARGETPLATFORM
RUN --mount=type=cache,id=pnpm-$TARGETPLATFORM,target=/.pnpm-store/ \
    --mount=type=bind,from=change-npmrc,source=/_/.npmrc,target=.npmrc \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    pnpm fetch --dev

# devDependenciesをインストールする => /_/node_modules/
FROM base AS dev-deps
WORKDIR /_
COPY --link --from=fetch-deps /_/node_modules/ ./node_modules/
ARG BUILDPLATFORM
RUN --mount=type=cache,id=pnpm-$BUILDPLATFORM,target=/.pnpm-store/ \
    --mount=type=bind,from=fetch-deps,source=/pnpm/,target=/pnpm/ \
    --mount=type=bind,from=change-npmrc,source=/_/.npmrc,target=.npmrc \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=.husky/install.mjs,target=.husky/install.mjs \
    pnpm install --frozen-lockfile --offline --dev

FROM base AS runner
WORKDIR /app
COPY --link prisma/ prisma/
COPY --link --from=fetch-deps /pnpm/ /pnpm/
COPY --link --from=dev-deps /_/node_modules/ ./node_modules/
COPY --link .npmrc package.json ./
ENTRYPOINT [ "pnpm", "--shell-emulator" ]
CMD [ "db:deploy" ]
