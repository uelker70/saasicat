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
                    // Vue resolves both spellings to one component, and this
                    // repository writes its own components PascalCase — so the
                    // house style leads straight to the form a kebab-only
                    // lookup would let past.
                    code: '<template><QDialog v-model="open" /></template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                    errors: [
                        { messageId: 'restricted', data: { name: 'QDialog', use: 'AdminDialog' } },
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

    // The other direction, for `@saasicat/ui-vue-tenant`: no Quasar component is
    // right there, and naming them would be a list that goes stale the day
    // Quasar adds one (ADR 0010).
    describe('a whole namespace', () => {
        const namespaced = [{ prefixes: { 'q-': 'a plain element or a primitive in `src/ui/`' } }];

        test('refuses every component in it, in both spellings', () => {
            sfc.run('no-restricted-components', rules['no-restricted-components'], {
                valid: [
                    {
                        // The point of the package: plain elements are right.
                        code: '<template><button type="button">Book</button></template>',
                        filename: '/repo/packages/ui-vue-tenant/src/ui/TenantButton.vue',
                        options: namespaced,
                    },
                    {
                        // A component of the package's own, whose name merely
                        // starts with the same letter.
                        code: '<template><TenantCard /></template>',
                        filename: '/repo/packages/ui-vue-tenant/src/TenantPlanSection.vue',
                        options: namespaced,
                    },
                    {
                        // Prose about what was replaced, which this package now
                        // carries in several files.
                        code: '<template><!-- q-card was here --><div /></template>',
                        filename: '/repo/packages/ui-vue-tenant/src/ui/TenantCard.vue',
                        options: namespaced,
                    },
                ],
                invalid: [
                    {
                        code: '<template><q-btn label="Book" /></template>',
                        filename: '/repo/packages/ui-vue-tenant/src/TenantPlanSection.vue',
                        options: namespaced,
                        errors: [
                            {
                                messageId: 'outside',
                                data: {
                                    name: 'q-btn',
                                    use: 'a plain element or a primitive in `src/ui/`',
                                },
                            },
                        ],
                    },
                    {
                        code: '<template><QSpinner /></template>',
                        filename: '/repo/packages/ui-vue-tenant/src/TenantPlanSection.vue',
                        options: namespaced,
                        errors: [
                            {
                                messageId: 'outside',
                                data: {
                                    name: 'QSpinner',
                                    use: 'a plain element or a primitive in `src/ui/`',
                                },
                            },
                        ],
                    },
                ],
            });
        });

        test('a named component still gets its own replacement named', () => {
            // Both options at once: the specific sentence is the useful one, so
            // it wins over the namespace it also matches.
            sfc.run('no-restricted-components', rules['no-restricted-components'], {
                valid: [],
                invalid: [
                    {
                        code: '<template><q-dialog v-model="open" /></template>',
                        filename: '/repo/src/pages/UsersPage.vue',
                        options: [
                            {
                                components: { 'q-dialog': 'AdminDialog' },
                                prefixes: { 'q-': 'a plain element' },
                            },
                        ],
                        errors: [
                            {
                                messageId: 'restricted',
                                data: { name: 'q-dialog', use: 'AdminDialog' },
                            },
                        ],
                    },
                ],
            });
        });
    });

    // `elements` is the third key, and the only one `allow` does not reach.
    // `src/ui/` may write a `<q-dialog>` because that is where `AdminDialog`
    // wraps one; no directory wraps an `<svg>`, and while the escape covered
    // them `WizardStepper.vue` drew its own checkmark under it.
    describe('markup the path escape must not reach', () => {
        const withElements = [
            {
                components: { 'q-dialog': 'AdminDialog' },
                elements: { svg: 'q-icon with a Material Icons name' },
                allow: ['src/ui/'],
            },
        ];

        test('reports an element even inside an allowed path', () => {
            sfc.run('no-restricted-components', rules['no-restricted-components'], {
                valid: [
                    {
                        // The escape still does its job for the component half.
                        code: '<template><q-dialog v-model="open" /></template>',
                        filename: '/repo/src/ui/overlay/AdminDialog.vue',
                        options: withElements,
                    },
                    {
                        code: '<template><q-icon name="check" size="11px" /></template>',
                        filename: '/repo/src/ui/page/WizardStepper.vue',
                        options: withElements,
                    },
                    {
                        // Not configured as an element: the tenant package
                        // draws its own glyphs and passes no `elements`.
                        code: '<template><svg viewBox="0 0 24 24" /></template>',
                        filename: '/repo/packages/ui-vue-tenant/src/ui/TenantDialog.vue',
                        options: [{ prefixes: { 'q-': 'a plain element' } }],
                    },
                ],
                invalid: [
                    {
                        code: '<template><svg viewBox="0 0 24 24" /></template>',
                        filename: '/repo/src/features/plan/PlanReview.vue',
                        options: withElements,
                        errors: [
                            {
                                messageId: 'restricted',
                                data: { name: 'svg', use: 'q-icon with a Material Icons name' },
                            },
                        ],
                    },
                    {
                        // The one the whole key exists for.
                        code: '<template><svg viewBox="0 0 24 24" /></template>',
                        filename: '/repo/src/ui/page/WizardStepper.vue',
                        options: withElements,
                        errors: [{ messageId: 'restricted' }],
                    },
                ],
            });
        });
    });
});

describe('no-hand-built-controls', () => {
    const options = [
        {
            components: { input: 'q-input', button: 'q-btn' },
            allow: ['src/ui/theme/'],
        },
    ];

    test('a control the system ships is not written by hand', () => {
        sfc.run('no-hand-built-controls', rules['no-hand-built-controls'], {
            valid: [
                {
                    code: '<template><q-input v-model="x" /></template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                },
                {
                    // An option surface keeps its native element, and says why
                    // where the next reader is already looking.
                    code:
                        '<template>\n' +
                        '    <!-- @optionSurface a segmented option with two lines of text,\n' +
                        '         one of a group, which q-btn renders as one -->\n' +
                        '    <button @click="pick" />\n' +
                        '</template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                },
            ],
            invalid: [
                {
                    code: '<template><input v-model="x" /></template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                    errors: [{ messageId: 'handBuilt' }],
                },
                {
                    // A tag is not a reason. The exception has to say something.
                    code:
                        '<template>\n' +
                        '    <!-- @optionSurface because -->\n' +
                        '    <button @click="pick" />\n' +
                        '</template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                    errors: [{ messageId: 'handBuilt' }],
                },
                {
                    // The declaration has to sit above THIS element, not three
                    // elements up.
                    code:
                        '<template>\n' +
                        '    <!-- @optionSurface a segmented option with two lines of text -->\n' +
                        '    <div />\n' +
                        '    <div />\n' +
                        '    <button @click="pick" />\n' +
                        '</template>',
                    filename: '/repo/src/pages/UsersPage.vue',
                    options,
                    errors: [{ messageId: 'handBuilt' }],
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
