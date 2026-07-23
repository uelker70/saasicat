import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/.prisma/**',
            '**/generated/**',
            '**/.integration-tmp/**',
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
    // (main) never loads Quasar. SFC directories are the Quasar layer and
    // stay unrestricted (they are not parsed here anyway — no Vue parser).
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
