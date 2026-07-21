#!/usr/bin/env node
// Q.4 — Codegen TS interfaces from the JSON schemas in @saasicat/spec.
//
// Reads the 4 schema files, generates one `src/generated/*.gen.ts` per schema.
// Snapshots are committed; a consistency test (`tests/codegen-drift.test.js`)
// regenerates + compares — drift fails.
//
// Usage:
//   pnpm --filter @saasicat/types gen:types

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchemaWithDefs, HEADER } from './codegen-helper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(HERE, '../../saas-platform-spec/schemas');
const OUT_DIR = resolve(HERE, '../src/generated');

const SCHEMAS = [
    { file: 'admin-manifest.schema.json', rootName: 'AdminManifest' },
    { file: 'plan-catalog.schema.json', rootName: 'PlanCatalog' },
    { file: 'promo-code.schema.json', rootName: 'PromoCode' },
    { file: 'audit-event.schema.json', rootName: 'AuditEvent' },
];

async function main() {
    await mkdir(OUT_DIR, { recursive: true });
    for (const { file, rootName } of SCHEMAS) {
        const schemaPath = join(SCHEMA_DIR, file);
        const raw = await readFile(schemaPath, 'utf8');
        const schema = JSON.parse(raw);
        const body = await compileSchemaWithDefs(schema, rootName);
        const outFile = join(OUT_DIR, file.replace('.schema.json', '.gen.ts'));
        const banner = HEADER.replace('{{schemaFile}}', file);
        await writeFile(outFile, banner + '\n' + body, 'utf8');

        console.log(`✓ ${file} → ${outFile}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
