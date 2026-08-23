// Every rule, against the code it must reject and the code it must not.
//
// A lint rule is the easiest thing in this repository to get vacuously right:
// it reports nothing, which looks exactly like a clean codebase. So each rule
// here has both halves — a `valid` case that would fail a rule written too
// broadly, and an `invalid` case that would pass one written too narrowly.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';

import { rules } from '../index.js';

const script = new RuleTester({
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

const sfc = new RuleTester({
    languageOptions: {
        parser: vueParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: { parser: tsParser },
    },
});

const props = (...names) => `defineProps<{ ${names.map((n) => `${n}: string;`).join(' ')} }>()`;

describe('max-props', () => {
    test('counts what a page declares', () => {
        script.run('max-props', rules['max-props'], {
            valid: [
                {
                    // Five is the ceiling, not the trigger.
                    code: props('a', 'b', 'c', 'd', 'e'),
                    filename: '/repo/src/pages/UsersPage.vue',
                    options: [{ 'src/pages': 5 }],
                },
                {
                    // A directory with no limit configured is not this rule's business.
                    code: props('a', 'b', 'c', 'd', 'e', 'f', 'g'),
                    filename: '/repo/src/internal/thing/Widget.vue',
                    options: [{ 'src/pages': 5 }],
                },
                {
                    // The longest configured prefix wins, so a primitive may be wider.
                    code: props('a', 'b', 'c', 'd', 'e', 'f', 'g'),
                    filename: '/repo/src/ui/data/AdminTable.vue',
                    options: [{ 'src/ui': 10, 'src/pages': 5 }],
                },
            ],
            invalid: [
                {
                    code: props('a', 'b', 'c', 'd', 'e', 'f'),
                    filename: '/repo/src/pages/UsersPage.vue',
                    options: [{ 'src/pages': 5 }],
                    errors: [{ messageId: 'tooMany' }],
                },
                {
                    // The runtime form counts too — otherwise the rule is one
                    // rewrite away from silence.
                    code: 'defineProps({ a: String, b: String, c: String })',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options: [{ 'src/pages': 2 }],
                    errors: [{ messageId: 'tooMany' }],
                },
            ],
        });
    });
});

describe('no-function-props', () => {
    test('rejects a callback prop and nothing else', () => {
        script.run('no-function-props', rules['no-function-props'], {
            valid: [
                {
                    code: 'defineProps<{ rows: Row[]; options?: Options }>()',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options: [{ directories: ['src/pages'] }],
                },
                {
                    // Outside the configured directories a callback is allowed:
                    // a primitive takes them, a page does not.
                    code: 'defineProps<{ onSave: () => void }>()',
                    filename: '/repo/src/ui/page/AdminForm.vue',
                    options: [{ directories: ['src/pages'] }],
                },
            ],
            invalid: [
                {
                    code: 'defineProps<{ onSave: () => void }>()',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options: [{ directories: ['src/pages'] }],
                    errors: [{ messageId: 'callback', data: { name: 'onSave' } }],
                },
                {
                    // Optional is the shape they actually take.
                    code: 'defineProps<{ loadRows?: (() => Promise<Row[]>) | undefined }>()',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options: [{ directories: ['src/pages'] }],
                    errors: [{ messageId: 'callback' }],
                },
            ],
        });
    });
});

describe('no-raw-http', () => {
    test('rejects fetch and axios outside the adapters', () => {
        script.run('no-raw-http', rules['no-raw-http'], {
            valid: [
                {
                    code: 'export const load = (http) => http("/admin/tenants");',
                    filename: '/repo/src/client/resources/tenants.resource.ts',
                    options: [{ allow: ['src/client/http/'] }],
                },
                {
                    // The adapters are where these two are supposed to appear.
                    code: 'const response = await fetch(url);',
                    filename: '/repo/src/client/http/fetch-http-client.ts',
                    options: [{ allow: ['src/client/http/'] }],
                },
                {
                    // A method called `fetch` on an object is not the global.
                    code: 'const rows = await repository.fetch(query);',
                    filename: '/repo/src/client/resources/tenants.resource.ts',
                    options: [{ allow: ['src/client/http/'] }],
                },
            ],
            invalid: [
                {
                    code: 'const response = await fetch("/admin/tenants");',
                    filename: '/repo/src/client/resources/tenants.resource.ts',
                    options: [{ allow: ['src/client/http/'] }],
                    errors: [{ messageId: 'fetch' }],
                },
                {
                    code: 'const response = await window.fetch("/admin/tenants");',
                    filename: '/repo/src/client/resources/tenants.resource.ts',
                    options: [{ allow: ['src/client/http/'] }],
                    errors: [{ messageId: 'fetch' }],
                },
                {
                    code: 'import axios from "axios";',
                    filename: '/repo/src/client/resources/tenants.resource.ts',
                    options: [{ allow: ['src/client/http/'] }],
                    errors: [{ messageId: 'axios' }],
                },
            ],
        });
    });
});

describe('no-restricted-components', () => {
    const options = [
        {
            components: { 'q-dialog': 'AdminDialog', 'q-table': 'AdminTable' },
            allow: ['src/ui/'],
        },
    ];

    test('reads the template, not the file', () => {
        sfc.run('no-restricted-components', rules['no-restricted-components'], {
            valid: [
                {
                    code: '<template><AdminTable :rows="rows" /></template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                },
                {
                    // The primitives are allowed to use what they wrap.
                    code: '<template><q-dialog v-model="open" /></template>',
                    filename: '/repo/src/ui/overlay/AdminDialog.vue',
                    options,
                },
                {
                    // A regex over the source reported this one. An AST does not.
                    code: '<template><!-- q-dialog was here --><div /></template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                },
            ],
            invalid: [
                {
                    code: '<template><q-dialog v-model="open" /></template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                    errors: [
                        { messageId: 'restricted', data: { name: 'q-dialog', use: 'AdminDialog' } },
                    ],
                },
                {
                    code: '<template><section><q-table :rows="rows" /></section></template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                    errors: [{ messageId: 'restricted' }],
                },
            ],
        });
    });
});

describe('the plugin is wired in', () => {
    test('every rule is used by the repository config', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
        const config = readFileSync(join(root, 'eslint.config.mjs'), 'utf8');

        // A rule nobody configures is a rule nobody runs, and it rots exactly
        // like documentation does — quietly, and while looking maintained.
        // The quoted key, not the bare name: `saasicat/no-raw-http` is a
        // prefix of `saasicat/no-raw-http-anything`, and a substring test
        // passes on a rule that was renamed out of use. The counter-proof for
        // this test found that.
        const unused = Object.keys(rules).filter((name) => !config.includes(`'saasicat/${name}':`));
        assert.deepEqual(unused, [], `configured nowhere: ${unused.join(', ')}`);
    });
});
