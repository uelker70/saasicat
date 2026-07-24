import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateReferenceSql } from '../scripts/generate-reference-sql.mjs';

// Guards two invariants at once:
//  1. the fragments compose into a VALID Prisma schema (the schema engine
//     rejects broken cross-fragment relations),
//  2. sql/reference-schema.postgres.sql is regenerated after fragment
//     changes (derived artifact stays in sync).

test('prisma-fragments compose and reference-schema.postgres.sql is in sync', () => {
    const generated = generateReferenceSql();
    const checkedIn = readFileSync(
        new URL('../sql/reference-schema.postgres.sql', import.meta.url),
        'utf8',
    );
    assert.equal(
        checkedIn,
        generated,
        'sql/reference-schema.postgres.sql is stale — run `pnpm run gen:sql` in packages/saas-platform-spec',
    );
});

test('normative constraints are part of the reference schema', () => {
    const sql = readFileSync(
        new URL('../sql/reference-schema.postgres.sql', import.meta.url),
        'utf8',
    );
    assert.match(sql, /plan_versions_draft_per_plan/);
    assert.match(sql, /bundle_versions_draft_per_bundle/);
});

test('bundle validity windows and their lookup index are in the reference schema', () => {
    const sql = readFileSync(
        new URL('../sql/reference-schema.postgres.sql', import.meta.url),
        'utf8',
    );
    assert.match(sql, /"validFrom" TIMESTAMP\(3\)/);
    assert.match(sql, /"validUntil" TIMESTAMP\(3\)/);
    assert.match(sql, /bundle_versions_bundleId_validFrom_idx/);
});

test('plan-version validity, termination and lookup index are in the reference schema', () => {
    const sql = readFileSync(
        new URL('../sql/reference-schema.postgres.sql', import.meta.url),
        'utf8',
    );
    const planVersionsTable = sql.match(/CREATE TABLE "plan_versions" \(([\s\S]*?)\n\);/)?.[1];

    assert.ok(planVersionsTable, 'plan_versions table expected');
    assert.match(planVersionsTable, /"validFrom" TIMESTAMP\(3\)/);
    assert.match(planVersionsTable, /"validUntil" TIMESTAMP\(3\)/);
    assert.match(planVersionsTable, /"endsAt" TIMESTAMP\(3\)/);
    assert.match(sql, /plan_versions_planId_validFrom_idx/);
});
