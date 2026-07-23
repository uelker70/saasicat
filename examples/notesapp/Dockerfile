# notesapp backend.
#
# Build context is the REPO ROOT, not this directory: the example depends on
# the `@saasicat/*` workspace packages, which are built from source here.

FROM node:24-slim AS build
WORKDIR /repo

# openssl is what Prisma probes for when it picks a query engine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# The whole workspace is copied before installing: `--frozen-lockfile` checks
# the lockfile against every project the workspace globs match, so a partial
# copy of the manifests would fail the check.
COPY . .
RUN pnpm install --frozen-lockfile

# Builds the platform packages in dependency order, then the example.
RUN pnpm --filter "notesapp-example..." build

WORKDIR /repo/examples/notesapp
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
