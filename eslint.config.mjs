import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs['flat/recommended'],
    // `eslint-config-prettier` must stay LAST of the shared configs: it switches
    // off the formatting rules the others enable, including `vue/html-indent` and
    // friends. Prettier owns formatting in this repo.
    eslintConfigPrettier,
    {
        // Single-file components carry TypeScript in `<script setup lang="ts">`.
        // `vue-eslint-parser` handles the SFC envelope and delegates the script
        // block to the TS parser.
        files: ['**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                extraFileExtensions: ['.vue'],
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // Type-based `defineProps<{ foo?: string }>()` already states what an
            // absent prop means: `undefined`. Demanding a runtime default would
            // push every optional prop through `withDefaults`, which changes
            // behaviour instead of documenting it — `AdminHero`'s optional
            // `subtitle` renders nothing, and that is the contract.
            'vue/require-default-prop': 'off',
        },
    },
    {
        // Library code runs in the consumer's browser. `warn`/`error` are the
        // channel through which the platform reports integration mistakes
        // (orphaned manifest actions, a failed manifest load); `log`/`info`/
        // `debug` are debugging leftovers and must not ship.
        files: ['packages/saas-platform-ui-vue/src/**/*.{ts,vue}'],
        rules: {
            'no-console': ['error', { allow: ['warn', 'error'] }],
        },
    },
    {
        // Test files mount throwaway stub components beside the component under
        // test — that is what makes them isolated.
        files: ['**/tests/**', '**/tests-*/**'],
        rules: {
            'vue/one-component-per-file': 'off',
        },
    },
    {
        // Every request leaves through the `HttpClient` a consumer registers via
        // `createSuperAdminApp({ http })`. A bare `fetch()` goes around that
        // seam and drops the app's Authorization header — the failure is
        // silent: the call 401s, one card renders an em dash, nothing logs.
        //
        // Three such call sites existed. One was unreachable code that looked
        // like a safeguard; two were live. `createFetchHttpClient()` is the
        // single sanctioned implementation — `defaultHttpClient()` delegates to
        // it — so the exemption stays one file wide.
        //
        // Structurally this closes when the resource registry REQUIRES an
        // `http` — until then, this rule is what prevents a relapse.
        files: ['packages/saas-platform-ui-vue/src/**/*.{ts,vue}'],
        ignores: ['packages/saas-platform-ui-vue/src/client/http/fetch-http-client.ts'],
        rules: {
            'no-restricted-globals': [
                'error',
                {
                    name: 'fetch',
                    message:
                        'Use the injected HttpClient (useSuperAdminHttp() in a component, or the ' +
                        '`http` option of a composable). A bare fetch() bypasses the consumer’s ' +
                        'auth. The only sanctioned implementation is createFetchHttpClient() in ' +
                        'src/client/http/fetch-http-client.ts.',
                },
            ],
            'no-restricted-properties': [
                'error',
                {
                    object: 'window',
                    property: 'fetch',
                    message: 'Use the injected HttpClient — see no-restricted-globals above.',
                },
                {
                    object: 'globalThis',
                    property: 'fetch',
                    message: 'Use the injected HttpClient — see no-restricted-globals above.',
                },
            ],
        },
    },
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/.prisma/**',
            '**/generated/**',
            '**/.integration-tmp/**',
            // A coding-agent session puts its git worktrees under `.claude/`,
            // so a second checkout of the whole repository sits inside this
            // one and `eslint .` reports another branch's files as ours. The
            // entry is repeated here because flat config does not read
            // `.gitignore` — Prettier does, so `.prettierignore` needs nothing.
            // `tests/agent-worktrees-are-not-linted.test.js` holds the two
            // files together.
            '**/.claude/**',
        ],
    },
    {
        // Tests, scripts, and server-side code (NestJS services) run under
        // Node.js — `process`, `console`, `setTimeout`, `URL`, `Buffer` etc.
        // are global bindings there, not browser-only.
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Deliberately ignore unused imports / vars with an underscore prefix
            // (convention for intentionally-unused parameters, e.g. in
            // stub/adapter signatures that fulfill the platform interface).
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
    // ------------------------------------------------------------------
    // Layer boundaries of @saasicat/ui-vue (see the package README):
    //
    //   client (framework-free)  ←  vue (no Quasar)  ←  quasar + SFC pages
    //
    // The rules encode the runtime guarantees of the package entries:
    // `@saasicat/ui-vue/client` never loads a framework, `@saasicat/ui-vue`
    // (main) never loads Quasar. SFC directories are the Quasar layer itself,
    // so they may import downwards without restriction — but they are parsed
    // and linted like every other file (see the `**/*.vue` block above).
    // ------------------------------------------------------------------
    {
        files: ['packages/saas-platform-ui-vue/src/client/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['vue', 'vue-router', 'pinia', 'quasar', '@vue/*', '@quasar/*'],
                            message:
                                'The client layer is framework-free — no Vue/Pinia/Quasar imports, not even type-only.',
                        },
                        {
                            group: ['../**'],
                            message:
                                'The client layer must not reach other layers — move shared code into src/client/ instead.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // Subdirectories of the client layer (e.g. i18n/): one `../` step
        // stays inside the layer, so only deeper escapes are blocked.
        files: ['packages/saas-platform-ui-vue/src/client/*/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['vue', 'vue-router', 'pinia', 'quasar', '@vue/*', '@quasar/*'],
                            message:
                                'The client layer is framework-free — no Vue/Pinia/Quasar imports, not even type-only.',
                        },
                        {
                            group: ['../../**'],
                            message:
                                'The client layer must not reach other layers — move shared code into src/client/ instead.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['packages/saas-platform-ui-vue/src/vue/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['quasar', '@quasar/*'],
                            message:
                                'The vue layer must not depend on Quasar — Quasar code belongs in src/quasar/ or the SFC directories.',
                        },
                        {
                            group: [
                                '../quasar/**',
                                '../pages-standard/**',
                                '../pages-tenant/**',
                                '../components/**',
                            ],
                            message:
                                'The vue layer must not import from the Quasar layer or the SFC directories.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['packages/saas-platform-ui-vue/src/index.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['quasar', '@quasar/*', './quasar/**'],
                            message:
                                'The main entry must stay Quasar-free at runtime — bootstrap exports live in @saasicat/ui-vue/quasar.',
                        },
                        {
                            // Everything inside the SFC directories is off
                            // limits except the five whitelisted framework-free
                            // type/i18n modules. Expressed as a regex because
                            // gitignore-style `!` negation cannot re-include a
                            // file whose intermediate directory is excluded.
                            regex: '^\\./(?:pages-standard/(?!(?:platform-email\\.types|email-history\\.types)\\.js$)|pages-tenant/(?!default-i18n\\.js$)|components/(?!(?:dialogs/types|bundle-editor/catalog-i18n)\\.js$))',
                            message:
                                'The main entry may only re-export the whitelisted framework-free type/i18n modules from the SFC directories.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // The whitelisted co-located modules above are part of the main
        // entry and therefore must stay framework-free themselves.
        files: [
            'packages/saas-platform-ui-vue/src/components/dialogs/types.ts',
            'packages/saas-platform-ui-vue/src/components/bundle-editor/catalog-i18n.ts',
            'packages/saas-platform-ui-vue/src/pages-standard/platform-email.types.ts',
            'packages/saas-platform-ui-vue/src/pages-standard/email-history.types.ts',
            'packages/saas-platform-ui-vue/src/pages-tenant/default-i18n.ts',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['vue', 'vue-router', 'pinia', 'quasar', '@vue/*', '@quasar/*'],
                            message:
                                'This module is re-exported through the Quasar-free main entry and must stay framework-free.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // Module interfaces (NestJS DynamicModule options) deliberately use
        // `any` as a loosely-typed slot for consumer factories — the
        // typecheck happens on the consumer side.
        files: ['**/*-nest.interfaces.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    {
        // CJS entry points may use `require()` — that's exactly what they're for.
        files: ['**/*.cjs'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        // Vite env declarations are by definition empty interfaces +
        // generic `any` slots that extend the standard slot.
        files: ['**/env.d.ts', '**/*.d.ts'],
        rules: {
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
