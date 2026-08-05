# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm-prod,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    DAYFRONT_WEB_ROOT=/app/web \
    DAYFRONT_SERVER_HOST=0.0.0.0 \
    DAYFRONT_SERVER_PORT=8080
WORKDIR /app
RUN apk add --no-cache su-exec tini
COPY --from=production-dependencies /workspace/node_modules ./node_modules
COPY --from=production-dependencies /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/web/dist ./web
COPY docker-entrypoint.sh /usr/local/bin/dayfront-entrypoint
RUN mkdir -p /config /data && chown -R node:node /app /config /data
RUN chmod 755 /usr/local/bin/dayfront-entrypoint
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD su-exec node node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/dayfront-entrypoint"]
CMD ["node", "apps/api/dist/server.js"]
