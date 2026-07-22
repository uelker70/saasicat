#!/bin/sh
# Brings the schema and the demo data up before serving. `db push` and the seed
# are both idempotent, so a restart is safe.
set -e

echo "notesapp: applying prisma schema…"
pnpm exec prisma db push --skip-generate

if [ "${SEED_ON_START:-true}" = "true" ]; then
    echo "notesapp: seeding demo data…"
    node dist/seed.js
fi

echo "notesapp: starting…"
exec node dist/main.js
