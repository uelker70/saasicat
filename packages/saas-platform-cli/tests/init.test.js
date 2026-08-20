import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    LIMIT_FILTER_PROVIDER,
    applyTokens,
    kebabCase,
    parseQuota,
    pascalCase,
    patchAppModule,
    planInit,
} from '../dist/index.js';

// `saasicat init` exists because the halves were the wrong way round: the
// frontend had a one-command generator and the backend had a markdown file to
// copy from. Thirteen files by hand, seven of them new, and the count written
// down nowhere — you find out while doing it.

const TEMPLATES = fileURLToPath(new URL('../templates/init/', import.meta.url));

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
    test('the minimum is six files', async () => {
        const { files } = await render({ projectKey: 'freshapp' });
        assert.deepEqual(
            files.map((f) => f.path),
            [
                'config/saas.yaml',
                'src/saas/feature-ui-registry.ts',
                'src/saas/admin-manifest.contribution.ts',
                'src/saas/freshapp-admin.module.ts',
                'src/saas/persistence.ts',
                'src/auth/freshapp-password.hasher.ts',
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
        assert.deepEqual(plan.quotaClasses, ['NotesQuotaProvider', 'SeatsQuotaProvider']);
    });

    test('--skip-hasher drops the hasher and keeps the persistence bundle', async () => {
        // It took the bundle with it at first, and the generated app then failed
        // its first boot on `core.adapters-bound` — the opposite of what this
        // command is for. The flag is about the hasher, not about persistence.
        const { files, plan } = await render({ projectKey: 'freshapp', skipHasher: true });
        assert.equal(plan.hasherClass, null);
        assert.ok(!files.some((f) => f.path.includes('password.hasher')));

        const persistence = files.find((f) => f.path === 'src/saas/persistence.ts');
        assert.ok(persistence, 'an app with no persistence bundle cannot boot');
        assert.doesNotMatch(persistence.content, /password\.hasher/);
        assert.match(persistence.content, /\/\/ passwordHasher: YourHasher/);
        assert.match(persistence.content, /setup wizard or self-registration/);
    });

    test('with a hasher the bundle wires it', async () => {
        const { files } = await render({ projectKey: 'freshapp' });
        const persistence = files.find((f) => f.path === 'src/saas/persistence.ts');
        assert.match(persistence.content, /passwordHasher: FreshappPasswordHasher,/);
        assert.match(persistence.content, /import \{ FreshappPasswordHasher \}/);
    });

    test('no file goes out with an unsubstituted token', async () => {
        // The failure this catches is silent: `__QUOTA_MODEL__` in a generated
        // file compiles as a property name and fails at runtime, in a file
        // nobody wrote and everybody trusts.
        for (const options of [
            { projectKey: 'freshapp' },
            { projectKey: 'freshapp', skipHasher: true },
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
            { projectKey: 'a', quotas: ['q:Q'] },
            { projectKey: 'a', skipHasher: true },
        ]) {
            for (const file of planInit(options).files) rendered.add(`${file.template}.tpl`);
        }
        const onDisk = await listTemplates(TEMPLATES);
        assert.deepEqual([...rendered].sort(), onDisk.sort());
    });
});

describe('the names it derives', () => {
    test('a multi-word key still produces valid identifiers', async () => {
        const { plan } = await render({ projectKey: 'team-hub', quotas: ['active-seats:Seat'] });
        assert.equal(plan.tokens.REGISTRY_CONST, 'TEAM_HUB_FEATURE_UI_REGISTRY');
        assert.equal(plan.tokens.ADMIN_MODULE_CLASS, 'TeamHubAdminModule');
        assert.deepEqual(plan.quotaClasses, ['ActiveSeatsQuotaProvider']);
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

    test('no quotas means an empty mapping, not a dangling key', async () => {
        const { files } = await render({ projectKey: 'freshapp' });
        const yaml = files.find((f) => f.path === 'config/saas.yaml').content;
        assert.match(yaml, /quotas: \{\}/);
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
