# syntax=docker/dockerfile:1.7.0@sha256:dbbd5e059e8a07ff7ea6233b213b36aa516b4c53c645f1817a4dd18b83cbea56

# ビルド時にベースとするイメージを定義
FROM ubuntu:devel@sha256:723ad8033f109978f8c7e6421ee684efb624eb5b9251b70c6788fdb2405d050b as base-build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# jqのバイナリを取得する => /jq
FROM ghcr.io/jqlang/jq:1.7@sha256:12f998e5a6f3f6916f744ba6f01549f156f624b42f7564e67ec6dd4733973146 as fetch-jq

# pnpmを取得する => /pnpm/
FROM quay.io/curl/curl-base:8.7.1@sha256:325f8ea5de36d06441189ce7b670f452794453561a040b8ae6cebaf19b316747 as fetch-pnpm
ENV SHELL="sh"
ENV ENV="/tmp/env"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /dist
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,from=fetch-jq,source=/jq,target=/mounted-bin/jq \
    curl -fsSL --compressed https://get.pnpm.io/install.sh | env PNPM_VERSION=$(cat package.json  | /mounted-bin/jq -r .packageManager | grep -oE '[0-9]+\.[0-9]+\.[0-9]+') sh -

# .npmrcに設定を追記する => /_/.npmrc
FROM base-build as change-npmrc
WORKDIR /_
COPY --link .npmrc ./
RUN echo "store-dir=/.pnpm-store" >> .npmrc

# Node.jsと依存パッケージを取得する => /pnpm/,/.pnpm-store/,/_/node_modules/
FROM base-build as fetch-deps
WORKDIR /_
COPY --link --from=fetch-pnpm /pnpm/ /pnpm/
RUN --mount=type=cache,id=pnpm-$TARGETPLATFORM,target=/.pnpm-store/ \
    --mount=type=bind,from=change-npmrc,source=/_/.npmrc,target=.npmrc \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    pnpm fetch

# dev用の依存パッケージをインストールする => /_/node_modules/
FROM --platform=$BUILDPLATFORM base-build as dev-deps
WORKDIR /_
COPY --link --from=fetch-deps /_/node_modules/ ./node_modules/
RUN --mount=type=cache,id=pnpm-$TARGETPLATFORM,target=/.pnpm-store/ \
    --mount=type=bind,from=fetch-deps,source=/pnpm/,target=/pnpm/ \
    --mount=type=bind,from=change-npmrc,source=/_/.npmrc,target=.npmrc \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=.husky/install.mjs,target=.husky/install.mjs \
    pnpm install --frozen-lockfile --offline

# ビルドする => /_/dist/
FROM --platform=$BUILDPLATFORM base-build as build
WORKDIR /_
RUN --mount=type=bind,from=fetch-deps,source=/pnpm/,target=/pnpm/ \
    --mount=type=bind,from=dev-deps,source=/_/node_modules/,target=node_modules/ \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,from=change-npmrc,source=/_/.npmrc,target=.npmrc \
    --mount=type=bind,source=src/,target=src/ \
    --mount=type=bind,source=.swcrc,target=.swcrc \
    pnpm build

# prod用の依存パッケージをインストールする => /_/node_modules/
FROM base-build as prod-deps
WORKDIR /_
COPY --link --from=fetch-deps /_/node_modules/ ./node_modules/
ARG NODE_ENV="production"
RUN --mount=type=cache,id=pnpm-$TARGETPLATFORM,target=/.pnpm-store/ \
    --mount=type=bind,from=fetch-deps,source=/pnpm/,target=/pnpm/ \
    --mount=type=bind,from=change-npmrc,source=/_/.npmrc,target=.npmrc \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=.husky/install.mjs,target=.husky/install.mjs \
    pnpm install --frozen-lockfile --offline

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:548d3e91231ffc84c1543da0b63e4063defc1f9620aa969e7f5abfafeb35afbe as runner
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV="production"
WORKDIR /app
COPY --link --from=fetch-deps /pnpm/ /pnpm/
COPY --link --from=build /_/dist/ ./dist/
COPY --link --from=prod-deps /_/node_modules/ ./node_modules/
COPY --link .npmrc package.json ./
ENTRYPOINT [ "pnpm", "--shell-emulator" ]
CMD [ "start" ]
