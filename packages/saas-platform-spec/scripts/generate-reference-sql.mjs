// Generates sql/reference-schema.postgres.sql from the prisma-fragments:
// compose all fragments into one schema, let the Prisma schema engine emit
// the DDL (no database needed), then append the hand-maintained
// constraints.postgres.sql.
//
// Run after every fragment change: `pnpm run gen:sql`.
// tests/reference-sql-drift.test.js fails CI when the artifact is stale.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const specRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function composeFragments() {
    const fragmentsDir = join(specRoot, 'prisma-fragments');
    const fragments = readdirSync(fragmentsDir)
        .filter((file) => file.endsWith('.prisma'))
        .sort();
    const header = [
        '// Composed from @saasicat/spec prisma-fragments — generated, do not edit.',
        'datasource db {',
        '    provider = "postgresql"',
        '    url      = "postgresql://user:pass@localhost:5432/saasicat?schema=public"',
        '}',
        '',
    ].join('\n');
    const body = fragments
        .map((file) => readFileSync(join(fragmentsDir, file), 'utf8'))
        .join('\n');
    return { schema: `${header}\n${body}`, fragments };
}

export function generateReferenceSql() {
    const { schema, fragments } = composeFragments();
    const workDir = mkdtempSync(join(tmpdir(), 'saasicat-spec-sql-'));
    try {
        const schemaPath = join(workDir, 'schema.prisma');
        writeFileSync(schemaPath, schema);
        const ddl = execFileSync(
            'pnpm',
            [
                'exec',
                'prisma',
                'migrate',
                'diff',
                '--from-empty',
                '--to-schema-datamodel',
                schemaPath,
                '--script',
            ],
            { cwd: specRoot, encoding: 'utf8' },
        );
        const constraints = readFileSync(join(specRoot, 'sql', 'constraints.postgres.sql'), 'utf8');
        return [
            '-- =============================================================================',
            '-- SaaSicat — PostgreSQL reference schema (DERIVED ARTIFACT).',
            '-- =============================================================================',
            '--',
            '-- Generated via `pnpm run gen:sql` from the prisma-fragments:',
            ...fragments.map((file) => `--   prisma-fragments/${file}`),
            '-- plus the normative constraints from sql/constraints.postgres.sql.',
            '-- Do not edit by hand — change the fragments/constraints and regenerate.',
            '',
            ddl.trim(),
            '',
            constraints.trim(),
            '',
        ].join('\n');
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

const invokedDirectly =
    process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
    const sql = generateReferenceSql();
    const target = join(specRoot, 'sql', 'reference-schema.postgres.sql');
    writeFileSync(target, sql);
    console.log(`written: ${target}`);
}
