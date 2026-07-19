import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    applyTokens,
    DEFAULT_TOKENS,
    parseArgs,
    scaffold,
    walkTemplates,
} from '../bin/create.js';

const TEMPLATES = new URL('../templates', import.meta.url).pathname;

describe('parseArgs', () => {
    test('positionals + flags + tokens werden getrennt', () => {
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
        // unverändert:
        assert.equal(result.tokens.LOGO_TEXT, DEFAULT_TOKENS.LOGO_TEXT);
    });
});

describe('applyTokens', () => {
    test('ersetzt nur Tokens, lässt andere __X__-Strings durch', () => {
        const out = applyTokens('hello __NAME__, ignore __UNKNOWN__', { NAME: 'World' });
        assert.equal(out, 'hello World, ignore __UNKNOWN__');
    });
});

describe('walkTemplates', () => {
    test('findet alle .tpl-Files unter templates/', async () => {
        const files = await walkTemplates(TEMPLATES);
        const rels = files.map((f) => f.relPath);
        assert.ok(rels.includes('package.json'), 'package.json fehlt');
        assert.ok(rels.includes('src/main.ts'), 'src/main.ts fehlt');
        assert.ok(rels.includes('src/router/routes.ts'), 'router/routes.ts fehlt');
        assert.ok(rels.includes('src/styles/theme.scss'), 'styles/theme.scss fehlt');
    });
});

describe('scaffold', () => {
    test('schreibt alle Templates ins target + ersetzt Tokens', async () => {
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
            assert.match(main, /apiBase: '\/api\/v1\/admin'/);

            const http = await readFile(join(target, 'src/services/http.ts'), 'utf8');
            assert.match(http, /notesapp-admin-token/);
        } finally {
            await rm(target, { recursive: true, force: true });
        }
    });

    test('dryRun schreibt nichts', async () => {
        const target = await mkdtemp(join(tmpdir(), 'spa-scaffold-dryrun-'));
        try {
            const writes = await scaffold({
                targetDir: target,
                templatesDir: TEMPLATES,
                tokens: DEFAULT_TOKENS,
                dryRun: true,
            });
            assert.ok(writes.length >= 5);
            // package.json darf NICHT geschrieben sein:
            await assert.rejects(() => readFile(join(target, 'package.json'), 'utf8'));
        } finally {
            await rm(target, { recursive: true, force: true });
        }
    });
});
