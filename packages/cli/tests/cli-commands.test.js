// project-key-history: the `v1-project-key` cases below carry the retired
// identifier, because removing it is what that command does.
// naming-history: the codemod cases below carry the pre-1.0 spellings on
// purpose — they are what the command rewrites.
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
const OWN_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));

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
    test('names every command', async () => {
        const { stdout, code } = await cli([]);
        assert.equal(code, 0);
        for (const command of ['schema apply', 'schema check', 'schema migrate', 'init']) {
            assert.match(stdout, new RegExp(command.replace(' ', '\\s')));
        }
    });

    test('and every `init` example it prints actually runs', async () => {
        // The example was `--app-key=x`, one character, which the catalogue
        // schema refuses. Then it was `--app-key=myapp` with no `--quota`,
        // which writes `quotas: {}` — also refused, and only at first boot.
        // Extracting the key and testing that alone missed the second one, so
        // this runs the whole line the help shows.
        const { stdout } = await cli([]);
        const examples = [...stdout.matchAll(/^ {2}(init .+)$/gm)]
            .map((m) => m[1].trim())
            .filter((line) => !line.includes('<'));
        assert.ok(examples.length > 0, `no runnable init example in:\n${stdout}`);

        for (const [index, example] of examples.entries()) {
            const root = await project(`help-example-${index}`);
            const {
                stdout: out,
                stderr,
                code,
            } = await cli(example.split(/\s+/), {
                cwd: root,
            });
            assert.equal(code, 0, `\`${example}\` exits ${code}: ${stderr || out}`);

            const yaml = await readFile(join(root, 'config', 'saas.yaml'), 'utf8');
            assert.doesNotMatch(
                yaml,
                /quotas: \{\}/,
                `\`${example}\` writes a catalogue the platform refuses`,
            );
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
        await writeFile(schemaPath, applied.replace(/^[ \t]*tenantId\s+String\?.*$/m, ''), 'utf8');

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

    test('the enums a fragment declares arrive with its models', async () => {
        // Fragment 01 declares BillingCycle and uses it on Subscription; a
        // schema with the model and not the enum fails Prisma validation.
        const root = await project('apply-enums');
        const schemaPath = join(root, 'prisma', 'schema.prisma');
        const { stdout, code } = await cli([
            'schema',
            'apply',
            '--fragments=01',
            `--prisma-schema=${schemaPath}`,
        ]);
        assert.equal(code, 0, stdout);
        assert.match(stdout, /Appended \d+ enum\(s\): .*BillingCycle/);
        const schema = await readFile(schemaPath, 'utf8');
        assert.match(schema, /^enum BillingCycle \{/m);
        assert.ok(
            schema.indexOf('enum BillingCycle') < schema.indexOf('model Subscription'),
            'the enum stands above the model that uses it',
        );
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
        const { stdout, code } = await cli(['init', '--app-key=notesapp', '--quota=notes:Note'], {
            cwd: root,
        });

        assert.equal(code, 0, stdout);
        const config = await readFile(join(root, 'config', 'saas.yaml'), 'utf8');
        assert.match(config, /name: Notesapp/);

        const appModule = await readFile(join(root, 'src', 'app.module.ts'), 'utf8');
        assert.match(appModule, /SaaSiCatModule\.forRoot/);
        // The generated module must not compile until a guard is named: an
        // empty array is how this platform is told an endpoint is deliberately
        // auth-free.
        assert.match(appModule, /guards: \[YourAuthGuard\]/);
        assert.match(stdout, /Name your auth guard/);
        assert.match(appModule, /imports: \[YourPrismaModule, YourAuthModule\]/);
        assert.match(stdout, /Name the modules in/);
    });

    test('refuses to overwrite what is already there', async () => {
        const root = await project('init-twice');
        await cli(['init', '--app-key=notesapp', '--quota=notes:Note'], { cwd: root });
        const { stdout, stderr, code } = await cli(
            ['init', '--app-key=notesapp', '--quota=notes:Note'],
            { cwd: root },
        );
        assert.notEqual(code, 0, 'the second run overwrote the first');
        assert.match(stdout + stderr, /already exist/i);
        assert.match(stdout + stderr, /config\/saas\.yaml/, 'it has to name what it refused');
    });

    test('a tsconfig on the old moduleResolution is refused before any write', async () => {
        // The generated files import subpath exports; under "node" none of
        // them resolves, in files the command just wrote.
        const root = await project('init-old-resolution');
        await writeFile(
            join(root, 'tsconfig.json'),
            '{ "compilerOptions": { "module": "commonjs", "moduleResolution": "node" } }\n',
            'utf8',
        );
        const { stderr, code } = await cli(['init', '--app-key=notesapp', '--quota=notes:Note'], {
            cwd: root,
        });
        assert.equal(code, 1);
        assert.match(stderr, /moduleResolution/);
        assert.match(stderr, /nodenext/);
        await assert.rejects(
            readFile(join(root, 'config', 'saas.yaml'), 'utf8'),
            'it wrote anyway',
        );
    });

    test('a moduleResolution inherited through extends is refused too', async () => {
        // Codex found the textual reader taking a base config for "unset".
        const root = await project('init-inherited-resolution');
        await writeFile(
            join(root, 'tsconfig.base.json'),
            '{ "compilerOptions": { "module": "commonjs", "moduleResolution": "node" } }\n',
            'utf8',
        );
        await writeFile(
            join(root, 'tsconfig.json'),
            '{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true } }\n',
            'utf8',
        );
        const { stderr, code } = await cli(['init', '--app-key=notesapp', '--quota=notes:Note'], {
            cwd: root,
        });
        assert.equal(code, 1);
        assert.match(stderr, /moduleResolution/);
        await assert.rejects(
            readFile(join(root, 'config', 'saas.yaml'), 'utf8'),
            'it wrote anyway',
        );
    });

    test('a key the generated files would refuse is refused here, before any write', async () => {
        const root = await project('init-bad-key');
        const { stderr, code } = await cli(['init', '--app-key=NotesApp'], { cwd: root });

        assert.equal(code, 1);
        assert.match(stderr, /not a valid app key/);
        await assert.rejects(readFile(join(root, 'config', 'saas.yaml'), 'utf8'));
    });

    test('without a key it says which flag is missing', async () => {
        const { stderr, code } = await cli(['init'], { cwd: dir });
        assert.equal(code, 1);
        assert.match(stderr, /--app-key/);
    });

    test('--dry-run lists the files and writes none of them', async () => {
        const root = await project('init-dry');
        const { stdout, code } = await cli(
            ['init', '--app-key=notesapp', '--quota=notes:Note', '--dry-run'],
            {
                cwd: root,
            },
        );
        assert.equal(code, 0, stdout);
        assert.match(stdout, /saas\.yaml/);
        await assert.rejects(readFile(join(root, 'config', 'saas.yaml'), 'utf8'));
    });
});

describe('codemod v1-imports', () => {
    /** A file carrying one of each shape a consumer meets. */
    const CONSUMER_SOURCE = [
        "import Gate from '@saasicat/ui-vue/components/FeatureGate.vue';",
        "import Shell from '@saasicat/ui-vue/pages/AdminLayout.vue';",
        "import Login from '@saasicat/ui-vue/pages-standard/SuperAdminLoginPage.vue';",
        "import Users from '@saasicat/ui-vue/pages/UsersPage.vue';",
        "import List from '@saasicat/ui-vue/components/plan-list/PlanList.vue';",
        "import { useThing } from '@saasicat/ui-vue';",
        '',
    ].join('\n');

    async function consumer(name) {
        const root = join(dir, name);
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, 'src', 'app.ts'), CONSUMER_SOURCE, 'utf8');
        return root;
    }

    test('rewrites what moved and leaves the rest alone', async () => {
        const root = await consumer('codemod-run');
        const { stdout, code } = await cli(['codemod', 'v1-imports', `--dir=${root}`]);

        assert.equal(code, 0, stdout);
        const after = await readFile(join(root, 'src', 'app.ts'), 'utf8');
        assert.match(after, /ui\/entitlement\/FeatureGate\.vue/);
        assert.match(after, /layouts\/AdminLayout\.vue/);
        assert.match(after, /auth\/SuperAdminLoginPage\.vue/);
        assert.match(
            after,
            /@saasicat\/ui-vue\/pages\/UsersPage\.vue/,
            'an already-correct path changed',
        );
        assert.match(
            after,
            /import \{ useThing \} from '@saasicat\/ui-vue';/,
            'the bare entry changed',
        );
    });

    test('names what no longer has a home rather than guessing one', async () => {
        // Rewriting it to something plausible turns "this is not public any
        // more" into a module-not-found on a path nobody wrote.
        const root = await consumer('codemod-unmapped');
        const { stdout } = await cli(['codemod', 'v1-imports', `--dir=${root}`]);

        assert.match(stdout, /no new home/i);
        assert.match(stdout, /components\/plan-list\/PlanList\.vue/);
        const after = await readFile(join(root, 'src', 'app.ts'), 'utf8');
        assert.match(after, /components\/plan-list\/PlanList\.vue/, 'it was rewritten anyway');
    });

    test('--dry-run reports without writing', async () => {
        const root = await consumer('codemod-dry');
        const { stdout, code } = await cli(['codemod', 'v1-imports', `--dir=${root}`, '--dry-run']);

        assert.equal(code, 0, stdout);
        assert.match(stdout, /Would rewrite/);
        assert.equal(await readFile(join(root, 'src', 'app.ts'), 'utf8'), CONSUMER_SOURCE);
    });

    test('it does not walk into node_modules or dist', async () => {
        // A consumer runs this at their repository root. Rewriting inside
        // dependencies or build output would be damage, not migration.
        const root = await consumer('codemod-skips');
        for (const skipped of ['node_modules', 'dist', 'dist-dev']) {
            await mkdir(join(root, skipped), { recursive: true });
            await writeFile(join(root, skipped, 'vendor.ts'), CONSUMER_SOURCE, 'utf8');
        }
        await cli(['codemod', 'v1-imports', `--dir=${root}`]);

        for (const skipped of ['node_modules', 'dist', 'dist-dev']) {
            assert.equal(
                await readFile(join(root, skipped, 'vendor.ts'), 'utf8'),
                CONSUMER_SOURCE,
                `the codemod wrote into ${skipped}/`,
            );
        }
    });
});

describe('codemod v1-project-key', () => {
    // The walk is the subject here, not the rewriting — that has its own unit
    // tests. What this pins is WHICH files the command opens: a consumer's
    // `config/saas.yaml` and their `schema.prisma` are not source files, and
    // both carry the identifier. The Prisma one is the expensive omission: it
    // was neither rewritten nor reported, so a consumer who ran `codemod v1`
    // and then the SQL migration was left with a schema declaring columns the
    // database no longer had.

    async function consumer(name) {
        const root = join(dir, name);
        await mkdir(join(root, 'prisma'), { recursive: true });
        await mkdir(join(root, 'config'), { recursive: true });
        await writeFile(
            join(root, 'prisma', 'schema.prisma'),
            [
                'model Plan {',
                '  id String @id',
                '  projectKey String',
                '  planKey String',
                '  @@unique([projectKey, planKey])',
                '}',
                '',
            ].join('\n'),
            'utf8',
        );
        await writeFile(
            join(root, 'config', 'saas.yaml'),
            ['schemaVersion: 1', 'projectKey: myapp', 'currency: EUR', ''].join('\n'),
            'utf8',
        );
        await writeFile(
            join(root, 'api.ts'),
            'const u = `/api/v1/admin/catalog/plans?projectKey=myapp`;\n',
            'utf8',
        );
        return root;
    }

    test('takes the key out of saas.yaml and the query, and reports the schema', async () => {
        const root = await consumer('codemod-pk');
        const { stdout, code } = await cli(['codemod', 'v1-project-key', `--dir=${root}`]);

        assert.equal(code, 0, stdout);

        const yaml = await readFile(join(root, 'config', 'saas.yaml'), 'utf8');
        assert.doesNotMatch(yaml, /projectKey/, "the config key is the platform's to remove");

        const api = await readFile(join(root, 'api.ts'), 'utf8');
        assert.equal(api.trim(), 'const u = `/api/v1/admin/catalog/plans`;');

        const schema = await readFile(join(root, 'prisma', 'schema.prisma'), 'utf8');
        assert.match(schema, /projectKey String/, "a schema is not this tool's to rewrite");
        assert.match(stdout, /prisma\/schema\.prisma:3/, 'but it has to be named');
        assert.match(stdout, /prisma\/schema\.prisma:5/, 'including the composite index');
    });

    test('is idempotent, like the other two', async () => {
        const root = await consumer('codemod-pk-twice');
        await cli(['codemod', 'v1-project-key', `--dir=${root}`]);
        const once = await readFile(join(root, 'api.ts'), 'utf8');
        const { code } = await cli(['codemod', 'v1-project-key', `--dir=${root}`]);
        assert.equal(code, 0);
        assert.equal(await readFile(join(root, 'api.ts'), 'utf8'), once);
    });
});

describe('codemod v1-rename', () => {
    const RENAME_SOURCE = [
        "import { SaasPlatformModule, type SaasPlatformModuleOptions } from '@saasicat/nest';",
        "import { FEATURE_UI_REGISTRY_TOKEN } from '@saasicat/nest/billing';",
        "import { runAdminPagesSuite } from '@saasicat/ui-vue/testing-e2e/admin-pages-suite';",
        "const MFA = Symbol.for('saas-platform/MfaPort');",
        "import Page from '@saasicat/ui-vue/pages/UsersPage.vue';",
        '',
    ].join('\n');

    async function consumer(name) {
        const root = join(dir, name);
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, 'src', 'app.ts'), RENAME_SOURCE, 'utf8');
        return root;
    }

    test('rewrites the four kinds of name and leaves the rest alone', async () => {
        const root = await consumer('rename-run');
        const { stdout, code } = await cli(['codemod', 'v1-rename', `--dir=${root}`]);

        assert.equal(code, 0, stdout);
        const after = await readFile(join(root, 'src', 'app.ts'), 'utf8');
        assert.match(after, /import \{ SaaSiCatModule, type SaaSiCatModuleOptions \}/);
        assert.match(after, /BILLING_FEATURE_UI_REGISTRY_TOKEN/);
        assert.match(after, /@saasicat\/ui-vue\/testing\/admin-pages-suite/);
        assert.match(after, /Symbol\.for\('saasicat\/nest\/MfaPort'\)/);
        assert.match(after, /@saasicat\/ui-vue\/pages\/UsersPage\.vue/);
        assert.doesNotMatch(after, /SaasPlatform|saas-platform\/|testing-e2e/);
        assert.match(stdout, /Rewrote \d+ name\(s\) in 1 file\(s\)/);
    });

    test('reports the token it cannot decide, and leaves it', async () => {
        const root = await consumer('rename-ambiguous');
        await writeFile(
            join(root, 'src', 'root.ts'),
            "import { FEATURE_UI_REGISTRY_TOKEN } from '@saasicat/nest';\n",
            'utf8',
        );
        const { stdout } = await cli(['codemod', 'v1-rename', `--dir=${root}`]);

        assert.match(stdout, /need a decision/i);
        assert.match(stdout, /FEATURE_UI_REGISTRY_TOKEN from '@saasicat\/nest'/);
        const untouched = await readFile(join(root, 'src', 'root.ts'), 'utf8');
        assert.match(untouched, /\bFEATURE_UI_REGISTRY_TOKEN\b/);
    });

    test('--dry-run reports and writes nothing', async () => {
        const root = await consumer('rename-dry');
        const { stdout, code } = await cli(['codemod', 'v1-rename', `--dir=${root}`, '--dry-run']);

        assert.equal(code, 0, stdout);
        assert.match(stdout, /Would rewrite/);
        assert.equal(await readFile(join(root, 'src', 'app.ts'), 'utf8'), RENAME_SOURCE);
    });

    test('the package rename reaches package.json, under its own indentation', async () => {
        const root = await consumer('rename-manifest');
        const manifest =
            '{\n  "name": "consumer",\n  "dependencies": {\n    "@saasicat/types": "^0.27.0"\n  }\n}\n';
        await writeFile(join(root, 'package.json'), manifest, 'utf8');
        const { stdout, code } = await cli(['codemod', 'v1-rename', `--dir=${root}`]);

        assert.equal(code, 0, stdout);
        const after = await readFile(join(root, 'package.json'), 'utf8');
        // The range is the CLI's own version, not the 0.x one carried over.
        // Compared as data, not by a pattern built from the version string.
        const own = JSON.parse(await readFile(OWN_MANIFEST, 'utf8')).version;
        assert.deepEqual(JSON.parse(after).dependencies, { '@saasicat/core': `^${own}` });
        assert.doesNotMatch(after, /@saasicat\/types/);
        assert.match(after, /^ {2}"name"/m);
        // The lockfile is the consumer's to regenerate, and the command says so.
        assert.match(stdout, /regenerate the lockfile/);
        assert.match(stdout, /pnpm install/);
    });

    test('a second run has nothing left to do', async () => {
        const root = await consumer('rename-twice');
        await cli(['codemod', 'v1-rename', `--dir=${root}`]);
        const once = await readFile(join(root, 'src', 'app.ts'), 'utf8');
        const { stdout } = await cli(['codemod', 'v1-rename', `--dir=${root}`]);
        assert.match(stdout, /Rewrote 0 name\(s\) in 0 file\(s\)/);
        assert.equal(await readFile(join(root, 'src', 'app.ts'), 'utf8'), once);
    });
});

describe('codemod v1', () => {
    test('runs the import rewrite and the rename, in that order', async () => {
        const root = join(dir, 'v1-both');
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(
            join(root, 'src', 'app.ts'),
            [
                "import Gate from '@saasicat/ui-vue/components/FeatureGate.vue';",
                "import { SaasPlatformModule } from '@saasicat/nest';",
                '',
            ].join('\n'),
            'utf8',
        );
        const { stdout, code } = await cli(['codemod', 'v1', `--dir=${root}`]);

        assert.equal(code, 0, stdout);
        const after = await readFile(join(root, 'src', 'app.ts'), 'utf8');
        assert.match(after, /ui\/entitlement\/FeatureGate\.vue/);
        assert.match(after, /SaaSiCatModule/);
        assert.match(stdout, /import\(s\)/);
        assert.match(stdout, /name\(s\)/);
    });
});
