# notesapp SuperAdmin UI.
#
# Build context is the REPO ROOT: the admin consumes `@saasicat/ui-vue` and
# `@saasicat/types` from the workspace, which are built from source here.
#
# nginx serves the built SPA and proxies /api to the backend, so browser and
# API share an origin and no CORS configuration is needed.

FROM node:24-slim AS build
WORKDIR /repo

RUN corepack enable

# See the backend Dockerfile: `--frozen-lockfile` validates the lockfile
# against the entire workspace, so the whole repo is copied before installing.
COPY . .
RUN pnpm install --frozen-lockfile

RUN pnpm --filter "notesapp-admin..." build

FROM nginx:1.27-alpine
COPY --from=build /repo/examples/notesapp/admin/dist /usr/share/nginx/html
COPY examples/notesapp/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
