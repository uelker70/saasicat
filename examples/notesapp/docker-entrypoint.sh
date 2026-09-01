#!/bin/sh
# Brings the schema and the demo data up before serving. Every step is
# idempotent, so a restart is safe.
set -e

# Before `db push`, because these are the things `db push` cannot do.
#
# `db push` refuses a change that would drop a column holding data, and rightly:
# it cannot know whether the rows still matter. The 1.0 removal of `projectKey`
# is exactly that change, so a container started against a database from an
# earlier release stopped here with `Use the --accept-data-loss flag`. Adding
# that flag would be the wrong fix — it would arm every future schema change to
# discard data without asking. Nor can it add a NOT NULL column to a table that
# already holds rows, which is what the line-item money facts are.
#
# Every shipped file is applied, in name order, off the directory rather than
# from a list here: a migration named in one place and applied in another is the
# one somebody forgets, and nothing would say so. Each file is written to be
# safe on a second run — they have to be, because this script runs on every
# container start. A consumer runs the same files once, by hand; see
# docs/guides/upgrade-to-1.0.md.
#
# The reference schema is the ground rather than a step, and the constraints go
# after the push because they constrain tables the push creates — so both are
# skipped here.
echo "notesapp: applying pending platform migrations…"
for migration in node_modules/@saasicat/spec/sql/*.sql; do
    case "$(basename "$migration")" in
        reference-schema.postgres.sql | constraints.postgres.sql) continue ;;
    esac
    echo "notesapp:   $(basename "$migration")"
    pnpm exec prisma db execute --file "$migration" --schema prisma/schema.prisma
done

echo "notesapp: applying prisma schema…"
pnpm exec prisma db push --skip-generate

# After the push, because `db push` is what creates the tables these constrain,
# and from the shipped file rather than a copy. The copy that used to live in
# `prisma/` held the two draft indexes and nothing else: the singleton `CHECK`
# added for 1.0 never reached a fresh notesapp database, and nothing would have
# said so. A file the platform owns cannot drift from itself.
#
# Not `|| true`: these are normative, and a database missing them is not a
# database this example should serve from.
pnpm exec prisma db execute \
    --file node_modules/@saasicat/spec/sql/constraints.postgres.sql \
    --schema prisma/schema.prisma

if [ "${SEED_ON_START:-true}" = "true" ]; then
    echo "notesapp: seeding demo data…"
    node dist/seed.js
fi

echo "notesapp: starting…"
exec node dist/main.js
