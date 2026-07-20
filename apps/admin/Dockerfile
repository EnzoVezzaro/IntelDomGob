# apps/admin/Dockerfile
# Minimal admin console — a pure client of the API gateway (SDK only).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN npm install --workspaces --include-workspace-root --legacy-peer-deps
WORKDIR /app/apps/admin
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:4300/ >/dev/null || exit 1
CMD ["npm", "run", "start"]
