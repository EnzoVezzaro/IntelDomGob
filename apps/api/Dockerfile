# apps/api/Dockerfile
# API service — runs the Express server that delegates to the Orchestrator.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache bash curl

# Install all workspace deps (monorepo).
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY providers ./providers
COPY services ./services
COPY apps/api ./apps/api

RUN npm install --workspaces --include-workspace-root

ENV NODE_ENV=production
ENV API_PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:4000/health || exit 1

WORKDIR /app/apps/api
CMD ["npm", "run", "start"]
