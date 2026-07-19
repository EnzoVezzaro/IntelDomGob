# apps/studio/Dockerfile
# Studio — the React SPA, served as static assets behind the reverse proxy.
# The Studio is a pure client of the API gateway; it is built and served by a
# tiny static server so it can live behind Caddy like any other app.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/studio ./apps/studio
# Work around an npm optional-dependency bug (npm/cli#4828) that can leave the
# rollup native binary uninstalled on alpine, breaking `vite build`. Removing
# the lockfile forces a fresh resolution of optional platform binaries.
RUN rm -f package-lock.json && npm install --workspaces --include-workspace-root
WORKDIR /app/apps/studio
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/apps/studio/dist /usr/share/nginx/html
COPY apps/studio/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
