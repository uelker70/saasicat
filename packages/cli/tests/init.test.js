import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planCatalogSchema } from '@saasicat/spec';

import {
    LIMIT_FILTER_PROVIDER,
    patchOptionsFor,
    applyTokens,
    kebabCase,
    parseQuota,
    pascalCase,
    patchAppModule,
    planInit,
    projectKeyPattern,
} from '../dist/index.js';

// `saasicat init` exists because the halves were the wrong way round: the
// frontend had a one-command generator and the backend had a markdown file to
// copy from. Thirteen files by hand, seven of them new, and the count written
// down nowhere — you find out while doing it.

const TEMPLATES = fileURLToPath(new URL('../templates/init', import.meta.url));

/** Renders the whole plan, the way the command does. */
async function render(options) {
    const plan = planInit(options);
    const files = [];
    for (const file of plan.files) {
        const raw = await readFile(join(TEMPLATES, `${file.template}.tpl`), 'utf8');
        files.push({
            path: file.path,
            content: applyTokens(raw, { ...plan.tokens, ...file.tokens }),
        });
    }
    return { plan, files };
}

describe('what gets written', () => {
    test('the minimum is seven files, one of them a quota provider', async () => {
        // Seven and not six: every plan must declare a quota, so the smallest
        // loadable catalogue has one, and something has to count it.
        const { files } = await render({ projectKey: 'freshapp', quotas: ['notes:Note'] });
        assert.deepEqual(
            files.map((f) => f.path),
            [
                'config/saas.yaml',
                'src/saas/feature-ui-registry.ts',
                'src/saas/admin-manifest.contribution.ts',
                'src/saas/freshapp-admin.module.ts',
                'src/saas/persistence.ts',
                'src/auth/freshapp-password.hasher.ts',
                'src/saas/notes-quota.provider.ts',
            ],
        );
    });

    test('each quota adds one provider, named after its key', async () => {
        const { files, plan } = await render({
            projectKey: 'freshapp',
            quotas: ['notes:Note', 'seats:TeamMember'],
        });
        const providers = files.filter((f) => f.path.includes('quota.provider'));
        assert.deepEqual(
            providers.map((f) => f.path),
            ['src/saas/notes-quota.provider.ts', 'src/saas/seats-quota.provider.ts'],
        );
        assert.deepEqual(
            plan.quotaProviders.map((q) => q.className),
            ['NotesQuotaProvider', 'SeatsQuotaProvider'],
        );
    });

    test('--skip-hasher drops the hasher and keeps the persistence bundle', async () => {
        // It took the bundle with it at first, and the generated app then failed
        // its first boot on `core.adapters-bound` — the opposite of what this
        // command is for. The flag is about the hasher, not about persistence.
        const { files, plan } = await render({
            projectKey: 'freshapp',
            quotas: ['notes:Note'],
            skipHasher: true,
        });
        assert.equal(plan.hasherClass, null);
        assert.ok(!files.some((f) => f.path.includes('password.hasher')));

        const persistence = files.find((f) => f.path === 'src/saas/persistence.ts');
        assert.ok(persistence, 'an app with no persistence bundle cannot boot');
        assert.doesNotMatch(persistence.content, /password\.hasher/);
        assert.match(persistence.content, /\/\/ passwordHasher: YourHasher/);
        assert.match(persistence.content, /setup wizard or self-registration/);
    });

    test('with a hasher the bundle wires it', async () => {
        const { files } = await render({ projectKey: 'freshapp', quotas: ['notes:Note'] });
        const persistence = files.find((f) => f.path === 'src/saas/persistence.ts');
        assert.match(persistence.content, /passwordHasher: FreshappPasswordHasher,/);
        assert.match(persistence.content, /import \{ FreshappPasswordHasher \}/);
    });

    test('no file goes out with an unsubstituted token', async () => {
        // The failure this catches is silent: `__QUOTA_MODEL__` in a generated
        // file compiles as a property name and fails at runtime, in a file
        // nobody wrote and everybody trusts.
        for (const options of [
            { projectKey: 'freshapp', quotas: ['notes:Note'] },
            { projectKey: 'freshapp', quotas: ['notes:Note'], skipHasher: true },
            { projectKey: 'multi-word-key', quotas: ['notes:Note'] },
        ]) {
            const { files } = await render(options);
            for (const file of files) {
                const leftover = file.content.match(/__[A-Z_]+__/g);
                assert.equal(leftover, null, `${file.path} in ${JSON.stringify(options)}`);
            }
        }
    });

    test('every template is reachable through some plan', async () => {
        // A template nothing renders is a file that rots: it stops compiling,
        // and the first person to need it finds out.
        const rendered = new Set();
        for (const options of [
            { projectKey: 'ab', quotas: ['q:Q'] },
            { projectKey: 'ab', quotas: ['notes:Note'], skipHasher: true },
        ]) {
            for (const file of planInit(options).files) rendered.add(`${file.template}.tpl`);
        }
        const onDisk = await listTemplates(TEMPLATES);
        assert.deepEqual([...rendered].sort(), onDisk.sort());
    });
});

describe('the names it derives', () => {
    test('a multi-word key still produces valid identifiers', async () => {
        const { plan } = await render({ projectKey: 'team-hub', quotas: ['activeSeats:Seat'] });
        assert.equal(plan.tokens.REGISTRY_CONST, 'TEAM_HUB_FEATURE_UI_REGISTRY');
        assert.equal(plan.tokens.ADMIN_MODULE_CLASS, 'TeamHubAdminModule');
        assert.deepEqual(
            plan.quotaProviders.map((q) => q.className),
            ['ActiveSeatsQuotaProvider'],
        );
    });

    test('the quota model becomes the Prisma delegate, not the model name', () => {
        // `prisma.Note` is undefined; `prisma.note` is the delegate. A
        // generated file that got this wrong would look like a schema problem.
        assert.deepEqual(parseQuota('notes:Note'), { key: 'notes', model: 'note' });
        assert.deepEqual(parseQuota('seats:TeamMember'), { key: 'seats', model: 'teamMember' });
    });

    test('a quota without a model counts a delegate named after the key', () => {
        assert.deepEqual(parseQuota('note'), { key: 'note', model: 'note' });
    });

    test('the case helpers round-trip the shapes the plan relies on', () => {
        assert.equal(pascalCase('team-hub'), 'TeamHub');
        assert.equal(kebabCase('TeamHub'), 'team-hub');
    });
});

describe('the YAML it writes', () => {
    test('quotas land under both plans, at different limits', async () => {
        const { files } = await render({ projectKey: 'freshapp', quotas: ['notes:Note'] });
        const yaml = files.find((f) => f.path === 'config/saas.yaml').content;
        assert.match(yaml, /quotas:\n {10}notes: 25/);
        assert.match(yaml, /quotas:\n {10}notes: 1000/);
    });

    test('there is no such thing as a plan without quotas', async () => {
        // This test used to assert the opposite — that `quotas: {}` was the
        // right rendering for the no-quota case. It IS correct YAML. It is
        // also a document the platform refuses: `quotas` is required on every
        // plan and carries `minProperties: 1`, so `init --project-key=x`
        // without `--quota` wrote every file, patched `app.module.ts`, printed
        // "Next steps" and produced an application whose first boot failed on
        // `/plans/0/quotas: must NOT have fewer than 1 properties`.
        //
        // Asserting on rendered text is what let it stand for a whole PR. The
        // suite loads the generated catalogue now — see
        // `generated-catalog-loads.test.js`.
        assert.throws(() => planInit({ projectKey: 'freshapp' }), /at least 1 --quota/);
    });

    test('nothing has a trailing space', async () => {
        // `quotas: __TOKEN__` with a multi-line value left one on every
        // generated file that had quotas — invisible, and rejected by the
        // formatter of whichever project it lands in.
        const { files } = await render({ projectKey: 'freshapp', quotas: ['notes:Note'] });
        for (const file of files) {
            assert.equal(/[ \t]+$/m.test(file.content), false, `${file.path} has a trailing space`);
        }
    });
});

const APP_MODULE = `import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [],
})
export class AppModule {}
`;

const PATCH_OPTIONS = {
    persistenceImport: './saas/persistence',
    adminModule: { className: 'FreshappAdminModule', importPath: './saas/freshapp-admin.module' },
    quotaProviders: [
        { className: 'NotesQuotaProvider', importPath: './saas/notes-quota.provider' },
    ],
    registry: {
        constName: 'FRESHAPP_FEATURE_UI_REGISTRY',
        importPath: './saas/feature-ui-registry',
    },
};

describe('patching an existing app.module.ts', () => {
    test('the admin module is registered, not merely imported', () => {
        // It carries `onModuleInit`, which is what registers the manifest
        // contribution. A module Nest never instantiates leaves the SuperAdmin
        // sidebar empty — the exact failure the generated file warns about in
        // its own header, and it was importing without registering.
        const { source } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        assert.match(source, /^\s*FreshappAdminModule,$/m);
    });

    test('nothing is imported that the inserted code does not use', () => {
        // The other direction of the check below, and the one that was missing.
        // Two unused imports are a lint error in the first project this lands
        // in — which is somebody's first impression of the framework.
        const { source } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        const imported = [...source.matchAll(/^import \{([^}]*)\} from/gm)]
            .flatMap((m) => m[1].split(','))
            .map((name) => name.trim())
            .filter(Boolean);

        for (const name of imported) {
            // Counted over the whole file, not over the part after the imports:
            // the fixture's own imports sit above the inserted ones, so a slice
            // would miss their declaration and call every one of them unused.
            const uses = [...source.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
            assert.ok(uses > 1, `${name} is imported and never used`);
        }
    });

    test('every symbol the block uses is imported', () => {
        // The one defect that makes the whole command worthless: a generated
        // file that does not compile. `loadPlanCatalogFromFile` was used and
        // not imported on the first run.
        const { source, status } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        assert.equal(status, 'patched');
        for (const symbol of [
            'loadPlanCatalogFromFile',
            'SaaSiCatModule',
            'defineSaaSiCat',
            'FRESHAPP_FEATURE_UI_REGISTRY',
            'NotesQuotaProvider',
            'persistence',
        ]) {
            const used = source.indexOf(symbol);
            const imported = source.indexOf(`import {`);
            assert.ok(used > -1, `${symbol} is not in the output at all`);
            assert.ok(
                new RegExp(`import \\{[^}]*\\b${symbol}\\b`).test(source),
                `${symbol} is used but never imported`,
            );
            assert.ok(imported > -1);
        }
    });

    test('what was already in the array keeps its own line', () => {
        const { source } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        assert.doesNotMatch(source, /\),PrismaModule/, 'the existing entry was glued to the block');
        assert.match(source, /\n {8}PrismaModule\]/);
    });

    test('the imports go after the last existing one', () => {
        // Above `reflect-metadata` or a polyfill would change evaluation order.
        const { source } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        const lines = source.split('\n');
        assert.match(lines[0], /@nestjs\/common/, 'the original first import moved');
    });

    test('running it twice does nothing the second time', () => {
        const once = patchAppModule(APP_MODULE, PATCH_OPTIONS).source;
        const twice = patchAppModule(once, PATCH_OPTIONS);
        assert.equal(twice.status, 'already-wired');
        assert.equal(twice.source, once);
    });

    test('a file it cannot edit is declined, with the block to paste', () => {
        const result = patchAppModule('export class AppModule {}\n', PATCH_OPTIONS);
        assert.equal(result.status, 'declined');
        assert.match(result.reason, /@Module/);
        assert.match(result.manualBlock, /SaaSiCatModule\.forRoot/);
        assert.match(result.manualBlock, /loadPlanCatalogFromFile/);
    });

    test('the limit filter is printed, not inserted', () => {
        // `providers` is where an app keeps its own wiring; an entry added into
        // the middle of it is the edit most likely to land somewhere surprising.
        const { source } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        assert.doesNotMatch(source, /APP_FILTER, useClass/);
        assert.match(LIMIT_FILTER_PROVIDER, /APP_FILTER/);
    });

    test('without persistence it comments the line instead of importing nothing', () => {
        const { source } = patchAppModule(APP_MODULE, {
            ...PATCH_OPTIONS,
            persistenceImport: null,
        });
        assert.doesNotMatch(source, /import \{ persistence \}/);
        assert.match(source, /\/\/ persistence: prismaPersistence/);
    });
});

/** Every `.tpl` under `dir`, as paths relative to it. */
async function listTemplates(dir, prefix = '') {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) found.push(...(await listTemplates(join(dir, entry.name), rel)));
        else if (entry.name.endsWith('.tpl')) found.push(rel);
    }
    return found;
}

describe('what the plan implies for the patch', () => {
    // This derivation had no test, and both leftovers of the first review round
    // were in it: `plan.ts` and `patchAppModule` were each covered and the step
    // between them, in `bin/saasicat.js`, was not. It lives in `plan.ts` now
    // precisely so this can exist.

    test('a generated persistence bundle is an imported one', () => {
        // It hung on `hasherClass` while the plan had started writing the
        // bundle in both cases, so `--skip-hasher` produced a file that existed
        // and was never wired — and an app that failed `core.adapters-bound` on
        // its first boot.
        for (const skipHasher of [false, true]) {
            const plan = planInit({ projectKey: 'freshapp', quotas: ['notes:Note'], skipHasher });
            const generated = plan.files.some((f) => f.path === 'src/saas/persistence.ts');
            const imported = patchOptionsFor(plan).persistenceImport !== null;
            assert.equal(
                imported,
                generated,
                `skipHasher=${skipHasher}: generated=${generated} but imported=${imported}`,
            );
        }
    });

    test('the admin module import path matches the file the plan writes', () => {
        const plan = planInit({ projectKey: 'team-hub', quotas: ['notes:Note'] });
        const written = plan.files.find((f) => f.path.includes('-admin.module'));
        const { adminModule } = patchOptionsFor(plan);
        assert.equal(`src/saas/${adminModule.importPath.replace('./saas/', '')}.ts`, written.path);
    });

    test('each quota provider import path matches its file', () => {
        const plan = planInit({
            projectKey: 'freshapp',
            quotas: ['notes:Note', 'activeSeats:Seat'],
        });
        const written = plan.files
            .filter((f) => f.path.includes('quota.provider'))
            .map((f) => f.path)
            .sort();
        const imported = patchOptionsFor(plan)
            .quotaProviders.map((q) => `src/saas/${q.importPath.replace('./saas/', '')}.ts`)
            .sort();
        assert.deepEqual(imported, written);
    });
});

describe('the auth guard the generator cannot know', () => {
    test('the block names one, so the file does not compile without it', () => {
        // `guards: []` is how the platform is told an endpoint is deliberately
        // auth-free — `discovery.module.ts` documents exactly that. A
        // placeholder empty array would have published GET /admin/discovery,
        // the whole capability inventory, plus the manifest routes. Not
        // compiling is the one failure mode nobody ships past.
        const { source } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        assert.match(source, /guards: \[YourAuthGuard\]/);
        assert.doesNotMatch(source, /guards: \[\s*(\/\*[^*]*\*\/)?\s*\]/);
    });

    test('and says why, where the reader is', () => {
        const { source } = patchAppModule(APP_MODULE, PATCH_OPTIONS);
        assert.match(source, /does NOT compile until you/);
        assert.match(source, /auth-free/);
    });
});

describe('a project key the platform would refuse', () => {
    // The generator wrote the key straight into `config/saas.yaml`, which the
    // platform validates against `plan-catalog.schema.json` at boot. So an
    // invalid key produced an application that could not start — after every
    // file had been written and `app.module.ts` patched. The command's own
    // help documented `--project-key=x`, which is one character and fails.

    test('is refused before anything is planned', () => {
        for (const key of ['x', 'NotesApp', '1notes', 'notes app', 'a'.repeat(32)]) {
            assert.throws(
                () => planInit({ projectKey: key }),
                /not a valid project key/,
                `planInit accepted ${JSON.stringify(key)}`,
            );
        }
    });

    test('and a valid one still plans', () => {
        assert.ok(planInit({ projectKey: 'notesapp', quotas: ['notes:Note'] }).files.length > 0);
        assert.ok(planInit({ projectKey: 'team-hub-2', quotas: ['notes:Note'] }).files.length > 0);
    });

    test('the rule comes from the schema, not from a copy of it', () => {
        // A second regex would be the same defect one level up: it would drift
        // from the loader and start accepting keys the platform refuses.
        assert.equal(projectKeyPattern().source, planCatalogSchema.properties.projectKey.pattern);
    });

    test('the message carries the pattern rather than a paraphrase of it', () => {
        const error = thrownBy(() => planInit({ projectKey: 'X' }));
        assert.match(error.message, new RegExp(escapeRegExp(projectKeyPattern().source)));
    });
});

/** The error a call threw, because `assert.throws` does not hand it back. */
function thrownBy(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    throw new Error('expected a throw');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('an app name a human would type', () => {
    // `--app-name` feeds two things with different alphabets: the label a
    // person reads in the YAML and the sidebar, and the identifiers of two
    // generated classes. One value did both, so `--app-name="My App"` wrote
    // `export class My AppAdminModule` — not TypeScript — after six files had
    // been written and `app.module.ts` patched.

    test('the classes get identifiers, the catalogue keeps the words', () => {
        const plan = planInit({
            projectKey: 'notesapp',
            appName: 'My App',
            quotas: ['notes:Note'],
        });
        assert.equal(plan.tokens.ADMIN_MODULE_CLASS, 'MyAppAdminModule');
        assert.equal(plan.hasherClass, 'MyAppPasswordHasher');
        assert.equal(plan.tokens.APP_LABEL, 'My App');
    });

    test('and the file names follow the identifier, not the label', () => {
        const plan = planInit({
            projectKey: 'notesapp',
            appName: 'My App',
            quotas: ['notes:Note'],
        });
        const paths = plan.files.map((f) => f.path);
        assert.ok(paths.includes('src/saas/my-app-admin.module.ts'), paths.join(' '));
        assert.ok(paths.includes('src/auth/my-app-password.hasher.ts'), paths.join(' '));
    });

    test('every generated class name is a valid identifier', () => {
        // The property, rather than the two cases above: whatever the option
        // is, nothing that ends up after `class` may contain a space.
        for (const appName of ['My App', 'my app', 'My-App', 'my.app', 'App 2']) {
            const plan = planInit({ projectKey: 'notesapp', appName, quotas: ['notes:Note'] });
            for (const value of [plan.hasherClass, plan.tokens.ADMIN_MODULE_CLASS]) {
                assert.match(value, /^[A-Za-z_$][\w$]*$/, `${appName} → ${value}`);
            }
        }
    });
});

describe('the file a quota provider is written to is the file that gets imported', () => {
    // Two spellings of one name: the file came from the quota key lowercased,
    // the import from the class name kebab-cased. They agree for `notes` and
    // part company for `apiCalls` — `apicalls-quota.provider.ts` written,
    // `./saas/api-calls-quota.provider` imported, TS2307. The plan carries the
    // path now, so there is one derivation instead of two.

    test('for a camel-cased key, where the two used to disagree', () => {
        const plan = planInit({ projectKey: 'notesapp', quotas: ['apiCalls:ApiCall'] });
        const written = plan.files
            .filter((f) => f.path.includes('quota.provider'))
            .map((f) => f.path);
        const imported = patchOptionsFor(plan).quotaProviders.map(
            (q) => `src/${q.importPath.replace(/^\.\//, '')}.ts`,
        );
        assert.deepEqual(imported, written);
    });

    test('and for every spelling the schema allows', () => {
        const plan = planInit({
            projectKey: 'notesapp',
            quotas: ['notes:Note', 'apiCalls:ApiCall', 'seats2:Seat'],
        });
        const written = plan.files
            .filter((f) => f.path.includes('quota.provider'))
            .map((f) => f.path)
            .sort();
        const imported = patchOptionsFor(plan)
            .quotaProviders.map((q) => `src/${q.importPath.replace(/^\.\//, '')}.ts`)
            .sort();
        assert.deepEqual(imported, written);
    });
});

describe('a root module whose last import spans several lines', () => {
    // Ordinary Prettier output past three named imports, and it was cut open at
    // its opening brace: the generated imports landed between `import {` and
    // `Module,`, and the file stopped being TypeScript.

    const MULTILINE = [
        "import 'reflect-metadata';",
        'import {',
        '    Module,',
        '    Injectable,',
        "} from '@nestjs/common';",
        '',
        '@Module({',
        '    imports: [],',
        '})',
        'export class AppModule {}',
        '',
    ].join('\n');

    test('stays intact, and the new imports go after it', () => {
        const { source } = patchAppModule(MULTILINE, PATCH_OPTIONS);
        assert.match(source, /import \{\n {4}Module,\n {4}Injectable,\n\} from '@nestjs\/common';/);

        const lines = source.split('\n');
        const closing = lines.findIndex((l) => l.includes("} from '@nestjs/common';"));
        const generated = lines.findIndex((l) => l.includes('@saasicat/nest/platform'));
        assert.ok(closing < generated, 'a generated import landed inside the existing statement');
    });

    test('and a side-effect import is an import too, so nothing lands above it', () => {
        // `import 'reflect-metadata'` has no `from`, and an import inserted
        // above it would change evaluation order — silently, until it is not.
        const source = [
            "import 'reflect-metadata';",
            '',
            '@Module({',
            '    imports: [],',
            '})',
            'export class AppModule {}',
            '',
        ].join('\n');
        const patched = patchAppModule(source, PATCH_OPTIONS).source.split('\n');
        assert.equal(patched[0], "import 'reflect-metadata';");
        assert.ok(
            patched.slice(1, 8).some((l) => l.includes('@saasicat/nest/platform')),
            patched.slice(0, 8).join(' | '),
        );
    });
});
