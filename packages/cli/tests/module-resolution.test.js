import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { judgeModuleResolution, readEffectiveModuleResolution } from '../dist/index.js';

// The config is read by TypeScript itself, so what is tested here is the
// two things a textual reader got wrong: a commented-out value, and a value
// that only a base config sets. Real files, real `extends`.

const ts = createRequire(import.meta.url)('typescript');

let dir;
before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'saasicat-modres-'));
});
after(async () => {
    await rm(dir, { recursive: true, force: true });
});

async function project(name, files) {
    const root = join(dir, name);
    await mkdir(root, { recursive: true });
    for (const [file, text] of Object.entries(files)) {
        await writeFile(join(root, file), text, 'utf8');
    }
    return root;
}

describe('readEffectiveModuleResolution', () => {
    test('reads the live value, not the commented-out one above it', async () => {
        const root = await project('commented', {
            'tsconfig.json': `{
  "compilerOptions": {
    // "moduleResolution": "node",
    "moduleResolution": "nodenext", /* since NestJS 10 */
  },
}`,
        });
        assert.equal(readEffectiveModuleResolution(root, ts), 'nodenext');
    });

    test('follows extends to a base config that sets the old resolution', async () => {
        const root = await project('inherited', {
            'tsconfig.base.json':
                '{ "compilerOptions": { "module": "commonjs", "moduleResolution": "node" } }',
            'tsconfig.json':
                '{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true } }',
        });
        assert.equal(readEffectiveModuleResolution(root, ts), 'node10');
    });

    test('a local value overrides the inherited one', async () => {
        const root = await project('overridden', {
            'tsconfig.base.json': '{ "compilerOptions": { "moduleResolution": "node" } }',
            'tsconfig.json':
                '{ "extends": "./tsconfig.base.json", "compilerOptions": { "moduleResolution": "bundler" } }',
        });
        assert.equal(readEffectiveModuleResolution(root, ts), 'bundler');
    });

    test('returns null when nothing in the chain sets it', async () => {
        const root = await project('unset', {
            'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
        });
        assert.equal(readEffectiveModuleResolution(root, ts), null);
    });

    test('returns null for a config TypeScript cannot parse, or none at all', async () => {
        const broken = await project('broken', { 'tsconfig.json': '{ "compilerOptions": ' });
        assert.equal(readEffectiveModuleResolution(broken, ts), null);
        const none = await project('none', {});
        assert.equal(readEffectiveModuleResolution(none, ts), null);
    });
});

describe('judgeModuleResolution', () => {
    test('accepts the three kinds that resolve subpath exports, and unset', () => {
        for (const v of ['node16', 'nodenext', 'bundler', null]) {
            assert.equal(judgeModuleResolution(v).ok, true, String(v));
        }
    });

    test('refuses node10 and classic, naming the setting the reader knows it by', () => {
        const verdict = judgeModuleResolution('node10');
        assert.equal(verdict.ok, false);
        assert.match(verdict.reason, /"node10" \(what TypeScript calls the "node" setting\)/);
        assert.match(verdict.reason, /node16.*nodenext.*bundler/);
        assert.equal(judgeModuleResolution('classic').ok, false);
    });
});
