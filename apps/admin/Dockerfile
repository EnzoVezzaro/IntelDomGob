# apps/admin/Dockerfile
# Builds the React/Vite SPA and serves it (plus /api proxy) via the Express
# server in src/server.ts. The Admin app is a pure client of the API gateway.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN npm install --workspaces --include-workspace-root --legacy-peer-deps
RUN npm run build -w @intel.dom.gob/app-admin
WORKDIR /app/apps/admin
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:4300/healthz >/dev/null || exit 1
CMD ["npm", "run", "start"]
