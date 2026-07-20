# workers/<name>/Dockerfile
# Worker service — an event-driven consumer of the DragonflyDB-backed event bus.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache bash curl

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY providers ./providers
COPY services ./services
COPY workers ./workers

RUN npm install --workspaces --include-workspace-root --legacy-peer-deps

ENV NODE_ENV=production
ENV REDIS_URL=redis://dragonfly:6379

# Workers are long-running event consumers; liveness = the node process is up.
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD pgrep -f "tsx src/index.ts" > /dev/null || exit 1

WORKDIR /app/workers/${WORKER:-ocr-worker}
CMD ["npm", "run", "start"]
