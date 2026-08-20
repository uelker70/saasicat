import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/saasicat.js', import.meta.url));

// The commands an integrator actually types, run as processes.
//
// Everything under `src/` is unit-tested and `bin/saasicat.js` was not — 682
// lines of argument reading, ordering, reporting and exit codes that no test
// had ever executed. It took a child-process test written for another reason to
// notice: the coverage ratchet had never seen this file at all, because nothing
// loaded it, so its 39% did not exist as a number.
//
// What these pin is what a unit test structurally cannot: which exit code a
// misuse produces, that a report reaches stdout, and that a `--dry-run` writes
// nothing anywhere. Deliberately no database — the Prisma steps are the one
// part that needs an environment, and `schema migrate --dry-run` returns before
// reaching them.

/** Runs the CLI and returns stdout, stderr and the exit code, never throwing. */
async function cli(args, options = {}) {
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], options);
        return { stdout, stderr, code: 0 };
    } catch (err) {
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
    }
}

const APP_MODULE = `import { Module } from '@nestjs/common';

@Module({
    imports: [],
    controllers: [],
    providers: [],
})
export class AppModule {}
`;

/** A schema with the datasource block the fragments are appended to. */
const EMPTY_SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
`;

let dir;

before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'saasicat-cli-'));
});

after(async () => {
    await rm(dir, { recursive: true, force: true });
});

/** A fresh working directory with a schema and an app module. */
async function project(name) {
    const root = join(dir, name);
    await mkdir(join(root, 'prisma'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'prisma', 'schema.prisma'), EMPTY_SCHEMA, 'utf8');
    await writeFile(join(root, 'src', 'app.module.ts'), APP_MODULE, 'utf8');
    return root;
}

describe('the help text', () => {
    test('names every command, and its own examples are valid', async () => {
        const { stdout, code } = await cli([]);
        assert.equal(code, 0);
        for (const command of ['schema apply', 'schema check', 'schema migrate', 'init']) {
            assert.match(stdout, new RegExp(command.replace(' ', '\\s')));
        }
        // The example was `--project-key=x`, which is one character and fails
        // the catalogue schema's own pattern — so the documented command
        // scaffolded an application that could not boot.
        const keys = [...stdout.matchAll(/--project-key=([\w-]+)/g)].map((m) => m[1]);
        for (const key of keys.filter((k) => k !== 'key')) {
            const { code: exit } = await cli(['init', `--project-key=${key}`, '--dir', dir]);
            assert.notEqual(exit, 1, `the help offers --project-key=${key}, which is refused`);
        }
    });

    test('an unknown command exits 1 rather than doing nothing', async () => {
        const { stderr, code } = await cli(['schema', 'frobnicate']);
        assert.equal(code, 1);
        assert.match(stderr, /Unknown command/);
    });
});

describe('schema check', () => {
    test('a model the app never adopted is reported, and is not an error', async () => {
        // The distinction the command is built on: a fragment you do not use is
        // not drift. Only a model you DID adopt and then diverged from is.
        const root = await project('check-unadopted');
        const { stdout, code } = await cli([
            'schema',
            'check',
            '--all',
            `--prisma-schema=${join(root, 'prisma', 'schema.prisma')}`,
        ]);
        assert.equal(code, 0, stdout);
        assert.match(stdout, /Not adopted/);
        assert.match(stdout, /not an error/i);
    });

    test('a field removed from an adopted model is drift, and exits 1', async () => {
        const root = await project('check-drift');
        const schemaPath = join(root, 'prisma', 'schema.prisma');
        await cli(['schema', 'apply', '--fragments=04', `--prisma-schema=${schemaPath}`]);

        // Take one field back out of the model the app now has.
        const applied = await readFile(schemaPath, 'utf8');
        await writeFile(schemaPath, applied.replace(/^\s*tenantId\s+String\?.*$/m, ''), 'utf8');

        const { stdout, code } = await cli([
            'schema',
            'check',
            '--fragments=04',
            `--prisma-schema=${schemaPath}`,
        ]);
        assert.equal(code, 1, stdout);
        assert.match(stdout, /Missing fields/);
        assert.match(stdout, /AuditLog\.tenantId/);
    });

    test('and says nothing is missing once the fragments are applied', async () => {
        const root = await project('check-clean');
        const schemaPath = join(root, 'prisma', 'schema.prisma');
        await cli(['schema', 'apply', '--all', `--prisma-schema=${schemaPath}`]);

        const { stdout, code } = await cli([
            'schema',
            'check',
            '--all',
            `--prisma-schema=${schemaPath}`,
        ]);
        assert.equal(code, 0, stdout);
        assert.match(stdout, /No drift/);
    });

    test('a schema that does not exist is an error, not a stack trace', async () => {
        const { stderr, code } = await cli([
            'schema',
            'check',
            '--all',
            `--prisma-schema=${join(dir, 'nowhere', 'schema.prisma')}`,
        ]);
        assert.equal(code, 1);
        assert.doesNotMatch(stderr, /at Object\.|at async/, 'a stack trace reached the user');
    });
});

describe('schema apply', () => {
    test('appends the selected fragments and says which', async () => {
        const root = await project('apply-some');
        const schemaPath = join(root, 'prisma', 'schema.prisma');
        const { stdout, code } = await cli([
            'schema',
            'apply',
            '--fragments=04',
            `--prisma-schema=${schemaPath}`,
        ]);
        assert.equal(code, 0, stdout);
        assert.match(stdout, /Appended/);
        assert.match(await readFile(schemaPath, 'utf8'), /model AuditLog \{/);
    });

    test('running it twice appends nothing the second time', async () => {
        const root = await project('apply-twice');
        const schemaPath = join(root, 'prisma', 'schema.prisma');
        await cli(['schema', 'apply', '--fragments=04', `--prisma-schema=${schemaPath}`]);
        const once = await readFile(schemaPath, 'utf8');

        const { stdout } = await cli([
            'schema',
            'apply',
            '--fragments=04',
            `--prisma-schema=${schemaPath}`,
        ]);
        assert.match(stdout, /Nothing to do|already present/);
        assert.equal(await readFile(schemaPath, 'utf8'), once);
    });

    test('a fragment selector that matches nothing is refused', async () => {
        const root = await project('apply-none');
        const { stderr, code } = await cli([
            'schema',
            'apply',
            '--fragments=99',
            `--prisma-schema=${join(root, 'prisma', 'schema.prisma')}`,
        ]);
        assert.equal(code, 1);
        assert.match(stderr, /Unknown fragments: 99/);
        assert.match(stderr, /Available: 01/, 'it has to say which selectors exist');
    });
});

describe('schema migrate', () => {
    test('without --name it says so instead of guessing one', async () => {
        const { stderr, code } = await cli(['schema', 'migrate']);
        assert.equal(code, 1);
        assert.match(stderr, /--name/);
    });

    test('--dry-run stops before Prisma, and says that it did', async () => {
        // The whole point of the flag, and it used to run
        // `prisma migrate dev --create-only` anyway — reaching the shadow
        // database and leaving a migration directory behind.
        const root = await project('migrate-dry');
        const schemaPath = join(root, 'prisma', 'schema.prisma');
        const before = await readFile(schemaPath, 'utf8');

        const { stdout, code } = await cli([
            'schema',
            'migrate',
            '--name=add_saasicat',
            '--all',
            '--dry-run',
            `--prisma-schema=${schemaPath}`,
        ]);

        assert.equal(code, 0, stdout);
        assert.match(stdout, /Step 1\/4/);
        assert.match(stdout, /skipped \(--dry-run\)/i);
        assert.equal(await readFile(schemaPath, 'utf8'), before, 'a dry run wrote the schema');
    });
});

describe('init', () => {
    test('scaffolds the wiring, patches the module, and names the next steps', async () => {
        const root = await project('init-ok');
        const { stdout, code } = await cli(
            ['init', '--project-key=notesapp', '--quota=notes:Note'],
            {
                cwd: root,
            },
        );

        assert.equal(code, 0, stdout);
        const config = await readFile(join(root, 'config', 'saas.yaml'), 'utf8');
        assert.match(config, /projectKey: notesapp/);

        const appModule = await readFile(join(root, 'src', 'app.module.ts'), 'utf8');
        assert.match(appModule, /SaaSiCatModule\.forRoot/);
        // The generated module must not compile until a guard is named: an
        // empty array is how this platform is told an endpoint is deliberately
        // auth-free.
        assert.match(appModule, /guards: \[YourAuthGuard\]/);
        assert.match(stdout, /Name your auth guard/);
    });

    test('refuses to overwrite what is already there', async () => {
        const root = await project('init-twice');
        await cli(['init', '--project-key=notesapp'], { cwd: root });
        const { stdout, stderr, code } = await cli(['init', '--project-key=notesapp'], {
            cwd: root,
        });
        assert.notEqual(code, 0, 'the second run overwrote the first');
        assert.match(stdout + stderr, /already exist/i);
        assert.match(stdout + stderr, /config\/saas\.yaml/, 'it has to name what it refused');
    });

    test('a key the platform would refuse is refused here, before any write', async () => {
        const root = await project('init-bad-key');
        const { stderr, code } = await cli(['init', '--project-key=NotesApp'], { cwd: root });

        assert.equal(code, 1);
        assert.match(stderr, /not a valid project key/);
        await assert.rejects(readFile(join(root, 'config', 'saas.yaml'), 'utf8'));
    });

    test('without a key it says which flag is missing', async () => {
        const { stderr, code } = await cli(['init'], { cwd: dir });
        assert.equal(code, 1);
        assert.match(stderr, /--project-key/);
    });

    test('--dry-run lists the files and writes none of them', async () => {
        const root = await project('init-dry');
        const { stdout, code } = await cli(['init', '--project-key=notesapp', '--dry-run'], {
            cwd: root,
        });
        assert.equal(code, 0, stdout);
        assert.match(stdout, /saas\.yaml/);
        await assert.rejects(readFile(join(root, 'config', 'saas.yaml'), 'utf8'));
    });
});
