# Single image for web + backend; compose picks the command.

# Zoekt, built from upstream sourcegraph/zoekt (Apache-2.0) at a pinned commit. The backend passes the
# repository name through -meta and the shard prefix through -shard_prefix_override, so no fork is needed.
# The module path is github.com/sourcegraph/zoekt, so build from a checkout, not with `go install ...@version`.
FROM golang:1.26-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS zoekt
RUN apk add --no-cache git
ARG ZOEKT_REF=0e68f41329d9c37f46942d4731495fa05b07882a
RUN git clone https://github.com/sourcegraph/zoekt /src && git -C /src checkout "$ZOEKT_REF"
WORKDIR /src
RUN go build -o /out/ ./cmd/zoekt-webserver ./cmd/zoekt-git-index

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
RUN apk add --no-cache git ctags && corepack enable
COPY --from=zoekt /out/ /usr/local/bin/
# Zoekt is Apache-2.0: ship its license text with the binaries.
COPY --from=zoekt /src/LICENSE /usr/share/licenses/zoekt/LICENSE
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false \
 && pnpm --filter @sbc/db generate \
 && pnpm --filter @sbc/web build
ENV NODE_ENV=production DATA_DIR=/data CTAGS_COMMAND=ctags
