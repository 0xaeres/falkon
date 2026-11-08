# Single image for backend + api + ui; compose picks the command.

# Zoekt, built from upstream sourcegraph/zoekt (Apache-2.0) at a pinned commit. The backend passes the
# repository name through -meta and the shard prefix through -shard_prefix_override, so no fork is needed.
# The module path is github.com/sourcegraph/zoekt, so build from a checkout, not with `go install ...@version`.
FROM golang:1.26-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS zoekt
RUN apk add --no-cache git
ARG ZOEKT_REF=0e68f41329d9c37f46942d4731495fa05b07882a
RUN git clone https://github.com/sourcegraph/zoekt /src && git -C /src checkout "$ZOEKT_REF"
WORKDIR /src
RUN go build -o /out/ ./cmd/zoekt-webserver ./cmd/zoekt-git-index

# Build stage: full frozen install (dev dependencies included), then the api bundle and the ui standalone output.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @falkon/db generate \
 && pnpm --filter @falkon/api build \
 && pnpm --filter @falkon/ui build \
 && cp -r apps/ui/.next/static apps/ui/.next/standalone/apps/ui/.next/static \
 && cp -r apps/ui/public apps/ui/.next/standalone/apps/ui/public

# Runtime dependencies stage: the api and backend (with db, shared, contracts) from the same frozen lockfile, without the ui.
# tsx and the Prisma CLI are dev dependencies the backend command needs at runtime, so they stay; the other
# dev-only packages (TypeScript, type definitions, the Lezer generator) are deleted with their links.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/backend/package.json apps/backend/
COPY apps/ui/package.json apps/ui/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/db/prisma packages/db/prisma
RUN pnpm install --frozen-lockfile --filter "@falkon/api..." --filter "@falkon/backend..." \
 && pnpm --filter @falkon/db generate \
 && rm -rf node_modules/.pnpm/typescript@* node_modules/.pnpm/@types+* node_modules/.pnpm/@lezer+generator@* \
 && find . -type l -exec sh -c 'for l; do [ -e "$l" ] || rm "$l"; done' _ {} +

# Runtime stage: dependencies, backend/db/shared/contracts sources (tsx runs them), the api bundle and the ui standalone output.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
RUN apk add --no-cache git ctags && corepack enable
COPY --from=zoekt /out/ /usr/local/bin/
# Zoekt is Apache-2.0: ship its license text with the binaries.
COPY --from=zoekt /src/LICENSE /usr/share/licenses/zoekt/LICENSE
WORKDIR /app
COPY --from=deps /app ./
# The backend command runs `pnpm`, so fetch the pinned version now rather than at first start.
RUN pnpm --version
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
COPY packages packages
COPY scripts/seed-product.ts scripts/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/ui/.next/standalone apps/ui/.next/standalone
ENV NODE_ENV=production DATA_DIR=/data CTAGS_COMMAND=ctags
