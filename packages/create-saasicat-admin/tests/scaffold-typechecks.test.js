// @requirement SC-COMP-009 — Shipped source stays within a language level an integrator's toolchain can read

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { scaffold } from '../bin/create.js';

// The templates are TypeScript that nothing in this repository compiles: the
// scaffolder copies them, the consumer's `vue-tsc` is the first to read them.
// So a template can call an option `@saasicat/ui-vue` no longer has, and every
// check here stays green — it did, for `getAuthToken`, until a fresh scaffold
// from npm was type-checked by hand. This test is that hand.
//
// The scaffolded app is type-checked against the workspace `@saasicat/ui-vue`
// and `@saasicat/core`, through a `node_modules` of symlinks into ui-vue's —
// which already holds vue, quasar, vue-router, axios, vite and vue-tsc,
// because ui-vue needs the same things to test itself.

const TEMPLATES = new URL('../templates', import.meta.url).pathname;
const WORKSPACE = new URL('../../..', import.meta.url).pathname;
const UI_VUE = join(WORKSPACE, 'packages', 'ui-vue');
const CORE = join(WORKSPACE, 'packages', 'core');

describe('a scaffolded admin type-checks against the ui-vue it was scaffolded for', () => {
    test('vue-tsc accepts the templates as written', async () => {
        assert.ok(
            existsSync(join(UI_VUE, 'node_modules', '.bin', 'vue-tsc')),
            'needs the workspace installed: packages/ui-vue/node_modules is missing vue-tsc',
        );
        assert.ok(
            existsSync(join(CORE, 'dist', 'index.d.ts')),
            'needs @saasicat/core built (pnpm -r build) — the templates import its types',
        );

        const target = await mkdtemp(join(tmpdir(), 'spa-typecheck-'));
        try {
            await scaffold({
                targetDir: target,
                templatesDir: TEMPLATES,
                tokens: {
                    APP_KEY: 'probe',
                    BRAND_NAME: 'Probe',
                    LOGO_TEXT: 'PR',
                    API_BASE: '/api',
                    DEV_PORT: '9100',
                    BACKEND_PORT: '3000',
                },
            });
            await linkNodeModules(target);

            const result = spawnSync(
                join(target, 'node_modules', '.bin', 'vue-tsc'),
                ['--noEmit', '-p', 'tsconfig.json'],
                { cwd: target, encoding: 'utf8' },
            );
            assert.equal(
                result.status,
                0,
                `vue-tsc rejected the scaffolded app:\n${result.stdout}${result.stderr}`,
            );
        } finally {
            await rm(target, { recursive: true, force: true });
        }
    });
});

/**
 * `node_modules` for the scaffolded app: every entry of ui-vue's, by symlink,
 * except `@saasicat`, which points at the workspace packages themselves.
 */
async function linkNodeModules(target) {
    const source = join(UI_VUE, 'node_modules');
    const modules = join(target, 'node_modules');
    await mkdir(modules);
    for (const entry of await readdir(source)) {
        if (entry === '@saasicat') continue;
        await symlink(join(source, entry), join(modules, entry));
    }
    await mkdir(join(modules, '@saasicat'));
    await symlink(UI_VUE, join(modules, '@saasicat', 'ui-vue'));
    await symlink(CORE, join(modules, '@saasicat', 'core'));
}
