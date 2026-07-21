// Q.4 — Codegen drift gate for the generated TypeScript types.
//
// Regenerates the TS files from the JSON schemas and compares them against the
// committed state. Drift = PR block. Anyone who changes a schema MUST also run
// `pnpm gen:types` and commit the new snapshots — that makes every schema cut
// visible in the PR diff.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchemaWithDefs, HEADER } from '../scripts/codegen-helper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(HERE, '../../saas-platform-spec/schemas');
const GEN_DIR = resolve(HERE, '../src/generated');

const SCHEMAS = [
    { file: 'admin-manifest.schema.json', rootName: 'AdminManifest' },
    { file: 'plan-catalog.schema.json', rootName: 'PlanCatalog' },
    { file: 'promo-code.schema.json', rootName: 'PromoCode' },
    { file: 'audit-event.schema.json', rootName: 'AuditEvent' },
];

async function regenerate(schemaFile, rootName) {
    const raw = await readFile(join(SCHEMA_DIR, schemaFile), 'utf8');
    const schema = JSON.parse(raw);
    const body = await compileSchemaWithDefs(schema, rootName);
    const banner = HEADER.replace('{{schemaFile}}', schemaFile);
    return banner + '\n' + body;
}

describe('Q.4 Codegen drift gate', () => {
    for (const { file, rootName } of SCHEMAS) {
        const genFile = file.replace('.schema.json', '.gen.ts');
        test(`${genFile} is in sync with ${file}`, async () => {
            const fresh = await regenerate(file, rootName);
            const committed = await readFile(join(GEN_DIR, genFile), 'utf8');
            if (fresh !== committed) {
                throw new Error(
                    `${genFile} ist nicht aktuell. Schema und committed Snapshot driften.\n` +
                        `Fix: \`pnpm --filter @saasicat/types gen:types\` laufen lassen ` +
                        `und das Diff in src/generated/${genFile} committen.`,
                );
            }
            assert.equal(fresh, committed);
        });
    }
});
