# Single image for web + backend; compose picks the command.
FROM golang:1.25-alpine AS zoekt
RUN apk add --no-cache git
RUN GOBIN=/out go install github.com/sourcegraph/zoekt/cmd/zoekt-webserver@latest \
 && GOBIN=/out go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@latest

FROM node:24-alpine
RUN apk add --no-cache git ctags && corepack enable
COPY --from=zoekt /out/ /usr/local/bin/
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false \
 && pnpm --filter @sbc/db generate \
 && pnpm --filter @sbc/web build
ENV NODE_ENV=production DATA_DIR=/data CTAGS_COMMAND=ctags
