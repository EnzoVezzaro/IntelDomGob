# docker/docs/Dockerfile
# Serves the platform documentation (docs/) as a static site behind Caddy at
# docs.<domain>. Markdown is served raw and an index.html provides navigation.
FROM node:22-alpine AS build
WORKDIR /docs-src
# Copy only the docs directory from the build context (repo root).
COPY docs ./docs

FROM nginx:alpine
COPY --from=build /docs-src/docs /usr/share/nginx/html/docs
COPY docker/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/docs/index.html /usr/share/nginx/html/index.html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
