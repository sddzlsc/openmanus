FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/control/package.json apps/control/
RUN pnpm install --filter @wiwana/control... --frozen-lockfile=false
COPY packages/protocol packages/protocol
COPY apps/control apps/control
RUN pnpm --filter @wiwana/control build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /src/apps/control/dist /app/dist
# Runtime dependencies are installed here instead of copied from the pnpm
# workspace, whose symlink layout does not survive a multi-stage COPY.
RUN cd /app \
    && npm init -y >/dev/null \
    && npm pkg set type=module >/dev/null \
    && npm install --omit=dev --no-audit --no-fund \
       fastify@^5.2.1 '@fastify/cookie@^11.0.2' '@fastify/cors@^11.0.1' \
       dockerode@^4.0.5 jose@^6.0.10 postgres@^3.4.5 zod@^3.24.2 fflate@^0.8.2
EXPOSE 8787
CMD ["node", "/app/dist/main.js"]
