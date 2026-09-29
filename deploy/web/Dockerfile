FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @wiwana/web... --frozen-lockfile=false
COPY packages/protocol packages/protocol
COPY apps/web apps/web
# Rewrite destinations are baked into the build, so the control-plane URL must
# be present now (compose service name by default).
ARG CONTROL_API_URL=http://control:8787
ENV CONTROL_API_URL=${CONTROL_API_URL}
RUN pnpm --filter @wiwana/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone bundle contains its own minimal node_modules; static assets and
# the public directory are mounted beside the generated server entry.
COPY --from=build /src/apps/web/.next/standalone /app
COPY --from=build /src/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /src/apps/web/public /app/apps/web/public
EXPOSE 3000
CMD ["node", "/app/apps/web/server.js"]
