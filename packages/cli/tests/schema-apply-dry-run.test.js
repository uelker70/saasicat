// @requirement SC-PRIV-009 — A migration that would destroy data stops and says what it found
// @requirement SC-OPS-002 — A migration is safe on a partially adopted schema

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/saasicat.js', import.meta.url));

// A dry run has one job: say what the real run will do.
//
// It said it in a form that could not carry the answer. The preview printed
// `result.schema.slice(schema.length)` — the text APPENDED to the end — while
// the real run writes `fk.schema`, whose foreign-key edits are rewritten lines
// INSIDE the existing schema. For an upgrade, where every platform model is
// already present, the appended tail is empty: the command announced that
// relations had been enabled and then printed nothing at all.
//
// So this is a child process rather than a unit test. What broke was the
// agreement between two runs of the command, and only running it twice can
// show that the agreement holds.

/** A schema with every model of the audit-log fragment, and a Tenant to point at. */
const EXISTING = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Tenant {
    id        String     @id
    auditLogs AuditLog[]
}
`;

let dir;
let schemaPath;

before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'saasicat-dry-run-'));
    await mkdir(join(dir, 'prisma'), { recursive: true });
    schemaPath = join(dir, 'prisma', 'schema.prisma');
});

after(async () => {
    await rm(dir, { recursive: true, force: true });
});

async function apply(extra) {
    const { stdout } = await run(process.execPath, [
        CLI,
        'schema',
        'apply',
        '--fragments=04',
        '--tenant-model=Tenant',
        `--prisma-schema=${schemaPath}`,
        ...extra,
    ]);
    return stdout;
}

/** The schema lines a dry run claims the real run will write. */
function previewedLines(stdout) {
    return [...stdout.matchAll(/^ {2}\d+: (.+)$/gm)].map((m) => m[1]);
}

/**
 * The upgrade case: every model of the fragment already present, one pointer
 * still commented. Rebuilt per test — the real run in one of them enables the
 * pointer, and a suite whose cases depend on each other's leftovers is a suite
 * that passes in one order only.
 */
async function upgradeCase() {
    await writeFile(schemaPath, EXISTING, 'utf8');
    await apply([]);
    const withModels = await readFile(schemaPath, 'utf8');
    assert.match(withModels, /model AuditLog \{/);
    await writeFile(
        schemaPath,
        withModels.replace(
            /^([ \t]*)(tenant Tenant\? @relation.*)$/m,
            (_m, indent, line) => `${indent}// ${line}`,
        ),
        'utf8',
    );
}

describe('the dry run previews what the real run writes', () => {
    test('it names the lines, and leaves the file untouched', async () => {
        await upgradeCase();
        const before = await readFile(schemaPath, 'utf8');
        const stdout = await apply(['--dry-run']);

        assert.match(stdout, /Would enable 1 foreign-key relation/);
        const previewed = previewedLines(stdout);
        assert.equal(previewed.length, 1, `preview showed nothing: ${JSON.stringify(stdout)}`);
        assert.match(previewed[0], /tenant Tenant\? @relation/);

        assert.equal(await readFile(schemaPath, 'utf8'), before, 'the dry run wrote to the file');
    });

    test('and the real run writes exactly those lines', async () => {
        await upgradeCase();
        const previewed = previewedLines(await apply(['--dry-run']));
        await apply([]);
        const written = await readFile(schemaPath, 'utf8');

        for (const line of previewed) {
            assert.ok(
                written.includes(line),
                `the preview promised "${line}", the run did not write it`,
            );
        }
        assert.doesNotMatch(
            written,
            /^[ \t]*\/\/ tenant Tenant\?/m,
            'the pointer is still commented',
        );
    });

    test('past tense belongs to the run that did it', async () => {
        // "Enabled 1 foreign-key relation" on a dry run is a claim about a file
        // the command did not touch.
        await upgradeCase();
        const dry = await apply(['--dry-run']);
        assert.match(dry, /Would enable/);
        assert.doesNotMatch(dry, /✓ Enabled/);
    });
});
