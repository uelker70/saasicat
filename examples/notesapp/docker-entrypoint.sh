#!/bin/sh
# Brings the schema and the demo data up before serving. Every step is
# idempotent, so a restart is safe.
set -e

# Before `db push`, because it is the one thing `db push` cannot do.
#
# `db push` refuses a change that would drop a column holding data, and rightly:
# it cannot know whether the rows still matter. The 1.0 removal of `projectKey`
# is exactly that change, so a container started against a database from an
# earlier release stopped here with `Use the --accept-data-loss flag`. Adding
# that flag would be the wrong fix — it would arm every future schema change to
# discard data without asking.
#
# The migration is the right one: it checks the rows first, refuses where they
# disagree, and does nothing at all once the column is gone. A consumer runs the
# same file once, by hand; see docs/guides/upgrade-to-1.0.md.
echo "notesapp: applying pending platform migrations…"
pnpm exec prisma db execute \
    --file node_modules/@saasicat/spec/sql/1.0-remove-project-key.postgres.sql \
    --schema prisma/schema.prisma

echo "notesapp: applying prisma schema…"
pnpm exec prisma db push --skip-generate
pnpm exec prisma db execute --file prisma/constraints.sql --schema prisma/schema.prisma || true

if [ "${SEED_ON_START:-true}" = "true" ]; then
    echo "notesapp: seeding demo data…"
    node dist/seed.js
fi

echo "notesapp: starting…"
exec node dist/main.js
