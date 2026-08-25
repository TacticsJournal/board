# syntax=docker/dockerfile:1

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:self-hosted

FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

LABEL org.opencontainers.image.title="Tactics Journal Board" \
      org.opencontainers.image.description="A football tactics board for drawing and importing screenshot positions" \
      org.opencontainers.image.source="https://github.com/TacticsJournal/board" \
      org.opencontainers.image.licenses="MIT"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY LICENSE TRADEMARKS.md THIRD_PARTY_NOTICES.md README.md SECURITY.md SUPPORT.md CONTRIBUTING.md CODE_OF_CONDUCT.md CHANGELOG.md CITATION.cff /usr/share/nginx/html/
COPY docs/ /usr/share/nginx/html/docs/

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget --spider --quiet http://127.0.0.1:8080/healthz || exit 1
