# Single image for web + backend; compose picks the command.

# Zoekt, built from the Sourcebot fork (github.com/sourcebot-dev/zoekt). Upstream zoekt lacks the
# -tenant_id / -repo_id indexer flags and the repository_id field the backend relies on.
# The module path inside the fork is still github.com/sourcegraph/zoekt, so it must be built
# from a checkout, not with `go install ...@version`.
FROM golang:1.26-alpine AS zoekt
RUN apk add --no-cache git
ARG ZOEKT_REF=b762b16dde4bee0eaae3faa56c7e195c8e2ad341
RUN git clone https://github.com/sourcebot-dev/zoekt /src && git -C /src checkout "$ZOEKT_REF"
WORKDIR /src
RUN go build -o /out/ ./cmd/zoekt-webserver ./cmd/zoekt-git-index

FROM node:24-alpine
RUN apk add --no-cache git ctags && corepack enable
COPY --from=zoekt /out/ /usr/local/bin/
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false \
 && pnpm --filter @sbc/db generate \
 && pnpm --filter @sbc/web build
ENV NODE_ENV=production DATA_DIR=/data CTAGS_COMMAND=ctags
