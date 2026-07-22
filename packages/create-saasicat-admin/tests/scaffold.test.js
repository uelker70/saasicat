import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { applyTokens, DEFAULT_TOKENS, parseArgs, scaffold, walkTemplates } from '../bin/create.js';

const TEMPLATES = new URL('../templates', import.meta.url).pathname;

describe('parseArgs', () => {
    test('positionals + flags + tokens are separated', () => {
        const result = parseArgs([
            'my-admin',
            '--project-key=notesapp',
            '--brand-name=NotesApp',
            '--dry-run',
        ]);
        assert.deepEqual(result.positionals, ['my-admin']);
        assert.equal(result.flags.dryRun, true);
        assert.equal(result.tokens.PROJECT_KEY, 'notesapp');
        assert.equal(result.tokens.BRAND_NAME, 'NotesApp');
        // unchanged:
        assert.equal(result.tokens.LOGO_TEXT, DEFAULT_TOKENS.LOGO_TEXT);
    });
});

describe('applyTokens', () => {
    test('replaces only tokens, passes other __X__ strings through', () => {
        const out = applyTokens('hello __NAME__, ignore __UNKNOWN__', { NAME: 'World' });
        assert.equal(out, 'hello World, ignore __UNKNOWN__');
    });
});

describe('walkTemplates', () => {
    test('finds all .tpl files under templates/', async () => {
        const files = await walkTemplates(TEMPLATES);
        const rels = files.map((f) => f.relPath);
        assert.ok(rels.includes('package.json'), 'package.json missing');
        assert.ok(rels.includes('src/main.ts'), 'src/main.ts missing');
        assert.ok(rels.includes('src/router/routes.ts'), 'router/routes.ts missing');
        assert.ok(rels.includes('src/styles/theme.scss'), 'styles/theme.scss missing');
    });
});

describe('scaffold', () => {
    test('writes all templates into target + replaces tokens', async () => {
        const target = await mkdtemp(join(tmpdir(), 'spa-scaffold-'));
        try {
            const tokens = {
                PROJECT_KEY: 'notesapp',
                BRAND_NAME: 'NotesApp',
                LOGO_TEXT: 'NA',
                API_BASE: '/api/v1/admin',
                DEV_PORT: '9100',
                BACKEND_PORT: '3000',
            };
            const writes = await scaffold({
                targetDir: target,
                templatesDir: TEMPLATES,
                tokens,
            });
            assert.ok(writes.length >= 5);

            const pkg = await readFile(join(target, 'package.json'), 'utf8');
            assert.match(pkg, /"name": "notesapp-admin"/);
            assert.match(pkg, /"@saasicat\/types": "\^\d+\.\d+\.\d+"/);
            assert.match(pkg, /"@saasicat\/ui-vue": "\^\d+\.\d+\.\d+"/);
            assert.doesNotMatch(pkg, /file:/);

            const main = await readFile(join(target, 'src/main.ts'), 'utf8');
            assert.match(main, /logoText: 'NA'/);
            assert.match(main, /name: 'NotesApp'/);

            const loaders = await readFile(
                join(target, 'src/services/platform-loaders.ts'),
                'utf8',
            );
            assert.match(loaders, /apiBase: '\/api\/v1\/admin'/);
            assert.match(loaders, /storageKeyPrefix: 'notesapp:'/);

            const http = await readFile(join(target, 'src/services/http.ts'), 'utf8');
            assert.match(http, /notesapp-admin-token/);
        } finally {
            await rm(target, { recursive: true, force: true });
        }
    });

    test('dryRun writes nothing', async () => {
        const target = await mkdtemp(join(tmpdir(), 'spa-scaffold-dryrun-'));
        try {
            const writes = await scaffold({
                targetDir: target,
                templatesDir: TEMPLATES,
                tokens: DEFAULT_TOKENS,
                dryRun: true,
            });
            assert.ok(writes.length >= 5);
            // package.json must NOT have been written:
            await assert.rejects(() => readFile(join(target, 'package.json'), 'utf8'));
        } finally {
            await rm(target, { recursive: true, force: true });
        }
    });
});

describe('bin entry point', () => {
    // Regression guard: package managers expose the bin through a symlink in
    // node_modules/.bin, so `npm create` / `npx` invoke a path that differs
    // from the module path. A plain `import.meta.url === file://argv[1]`
    // comparison silently skips main() there — the published 0.2.0 scaffolder
    // exited 0 without writing anything because of exactly that.
    test('runs through a bin symlink, as npm create / npx invoke it', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spa-binlink-'));
        try {
            const link = join(dir, 'create-saasicat-admin');
            await symlink(new URL('../bin/create.js', import.meta.url).pathname, link);

            const target = join(dir, 'generated');
            const res = spawnSync(
                process.execPath,
                [link, target, '--project-key=demoapp', '--no-install'],
                { encoding: 'utf8' },
            );

            assert.equal(res.status, 0, `exited ${res.status}: ${res.stderr}`);
            assert.match(res.stdout, /Created \d+ file\(s\)/, 'scaffolder produced no output');

            const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
            assert.match(pkg.dependencies['@saasicat/ui-vue'], /^\^\d+\.\d+\.\d+$/);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
