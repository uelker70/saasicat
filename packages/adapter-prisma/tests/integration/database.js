// The database an integration suite runs against: a Prisma client generated
// from the composed prisma-fragments, and tables built from the normative
// reference DDL. Each suite generates into a directory of its own under
// `.integration-tmp`, so suites that run side by side do not overwrite each
// other's client, and every tool that leaves generated code alone skips both.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const specRoot = dirname(require.resolve('@saasicat/spec/package.json'));

/** `SAASICAT_TEST_DATABASE_URL`, which every integration suite requires. */
export function testDatabaseUrl() {
    const url = process.env.SAASICAT_TEST_DATABASE_URL;
    if (!url) {
        throw new Error(
            'SAASICAT_TEST_DATABASE_URL is required for the integration tests — point it at a ' +
                'disposable PostgreSQL database (see the header of persistence-contract.integration.test.js).',
        );
    }
    return url;
}

function composeSchema() {
    const fragmentsDir = join(specRoot, 'prisma-fragments');
    const fragments = readdirSync(fragmentsDir)
        .filter((file) => file.endsWith('.prisma'))
        .sort()
        .map((file) => readFileSync(join(fragmentsDir, file), 'utf8'));
    const header = [
        '// Composed from @saasicat/spec prisma-fragments — generated for the',
        '// integration tests, do not edit.',
        'datasource db {',
        '    provider = "postgresql"',
        '    url      = env("SAASICAT_TEST_DATABASE_URL")',
        '}',
        'generator client {',
        '    provider = "prisma-client-js"',
        '    output   = "./generated-client"',
        '}',
        '',
    ].join('\n');
    return `${header}\n${fragments.join('\n')}`;
}

/** The `PrismaClient` class generated into `<package>/.integration-tmp/<suite>`. */
export function generatedPrismaClient(suite) {
    const workDir = join(packageRoot, '.integration-tmp', suite);
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    const schemaPath = join(workDir, 'schema.prisma');
    writeFileSync(schemaPath, composeSchema());
    execFileSync('pnpm', ['exec', 'prisma', 'generate', `--schema=${schemaPath}`], {
        cwd: packageRoot,
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
        stdio: 'inherit',
    });
    return require(join(workDir, 'generated-client')).PrismaClient;
}

function sqlStatements(file) {
    return readFileSync(file, 'utf8')
        .split(';')
        .map((statement) =>
            statement
                .split('\n')
                .filter((line) => !line.trim().startsWith('--'))
                .join('\n')
                .trim(),
        )
        .filter(Boolean);
}

/** Drops the `public` schema `prisma` reaches and builds it again from the reference DDL. */
export async function rebuildFromReferenceSchema(prisma) {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
    for (const statement of sqlStatements(join(specRoot, 'sql', 'reference-schema.postgres.sql'))) {
        await prisma.$executeRawUnsafe(statement);
    }
}
