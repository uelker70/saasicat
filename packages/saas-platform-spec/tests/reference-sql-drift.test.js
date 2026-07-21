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
    assert.match(sql, /business_type_versions_draft_per_business_type/);
    assert.match(sql, /subscriptions_plan_or_bt_check/);
});
