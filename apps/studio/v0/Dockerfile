# apps/studio/v0/Dockerfile
# Legacy React SPA client — preserved for reference/rollback.
# Studio — the React SPA, served as static assets behind the reverse proxy.
# The Studio is a pure client of the API gateway; it is built and served by a
# tiny static server so it can live behind Caddy like any other app.
FROM node:22-alpine AS build
WORKDIR /app
# Copy the monorepo root manifest + workspace sources so `npm install
# --workspaces` resolves the @intel.dom.gob/* workspace links correctly.
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY providers ./providers
COPY services ./services
COPY apps ./apps
# Work around an npm optional-dependency bug (npm/cli#4828) that can leave the
# rollup native binary uninstalled on alpine, breaking `vite build`. Removing
# the lockfile forces a fresh resolution of optional platform binaries.
RUN rm -f package-lock.json && npm install --workspaces --include-workspace-root --legacy-peer-deps
# Build this workspace from the monorepo root (the app now lives at
# apps/studio/v0 after the legacy SPA was moved there).
RUN npm run build -w @intel.dom.gob/app-studio

FROM nginx:alpine
COPY --from=build /app/apps/studio/v0/dist /usr/share/nginx/html
COPY apps/studio/v0/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
