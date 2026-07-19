// Q.4 — Codegen-Drift-Gate für die generated TypeScript-Types.
//
// Regeneriert die TS-Files aus den JSON-Schemas und vergleicht sie mit dem
// committed Stand. Drift = PR-Block. Wer ein Schema ändert, MUSS auch
// `pnpm gen:types` laufen lassen und die neuen Snapshots committen — das
// macht jeden Schema-Cut sichtbar im PR-Diff.

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

describe('Q.4 Codegen-Drift-Gate', () => {
    for (const { file, rootName } of SCHEMAS) {
        const genFile = file.replace('.schema.json', '.gen.ts');
        test(`${genFile} ist im Sync mit ${file}`, async () => {
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
