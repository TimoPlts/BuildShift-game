# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@12.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/game-server/package.json ./apps/game-server/package.json
COPY packages/game-config/package.json ./packages/game-config/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/simulation/package.json ./packages/simulation/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/
# Public routing choice only. API credentials are supplied at container runtime.
ENV VITE_GAME_SERVER_URL=same-origin
RUN pnpm build
RUN pnpm --filter @buildshift/game-server deploy --prod /runtime/game

FROM node:24-bookworm-slim AS game
ENV NODE_ENV=production GAME_SERVER_PORT=2567
WORKDIR /app
COPY --from=build --chown=node:node /runtime/game/ ./
COPY --chown=node:node docs/ ./docs/
COPY --chown=node:node CONTRACT.md ./CONTRACT.md
USER node
EXPOSE 2567
CMD ["node", "dist/index.js"]

FROM nginx:stable-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist/ /usr/share/nginx/html/
EXPOSE 80
