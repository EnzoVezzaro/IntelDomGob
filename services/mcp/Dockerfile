# services/mcp/Dockerfile
# The MCP server — a pure client of the API gateway, exposed via Caddy.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY providers ./providers
COPY services/mcp ./services/mcp
RUN npm install --workspaces --include-workspace-root
WORKDIR /app/services/mcp
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:4100/health >/dev/null || exit 1
CMD ["npm", "run", "start"]
