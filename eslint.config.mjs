import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';
import regexp from 'eslint-plugin-regexp';

/**
 * A regular expression built from a value: a template literal with an
 * expression, a concatenation, or a bare identifier handed to `new RegExp`.
 * Shared by the error block (everything) and the ratchet block (warning in
 * the files that carried findings the day the rule arrived).
 */
const REGEX_FROM_VALUE = [
    {
        selector:
            "NewExpression[callee.name='RegExp'] > TemplateLiteral.arguments:first-child[expressions.length>0]",
        message:
            'A regular expression built from a value. Parse the text and compare data, ' +
            'or escape EVERY metacharacter through one tested function and say so in a ' +
            'disable comment — hand escaping is what CodeQL reports as incomplete.',
    },
    {
        selector:
            "NewExpression[callee.name='RegExp'] > BinaryExpression.arguments:first-child[operator='+']",
        message:
            'A regular expression concatenated from a value. Parse the text and compare ' +
            'data, or escape every metacharacter through one tested function.',
    },
    {
        selector: "NewExpression[callee.name='RegExp'] > Identifier.arguments:first-child",
        message:
            'A regular expression from a variable. If it is a literal pattern, write it ' +
            'as one; if it is a value, parse and compare instead.',
    },
];

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs['flat/recommended'],
    // `eslint-config-prettier` must stay LAST of the shared configs: it switches
    // off the formatting rules the others enable, including `vue/html-indent` and
    // friends. Prettier owns formatting in this repo.
    eslintConfigPrettier,
    {
        // Two classes of regular-expression defect, both found by CodeQL on
        // pull requests before anything here asked about them — three times in
        // two days, each time in freshly written code.
        //
        // `no-super-linear-backtracking`: a pattern whose quantifiers can share
        // one input more than one way backtracks quadratically, and the input
        // is a consumer's file. `v1-rename.ts` had two.
        //
        // `no-restricted-syntax` below: a pattern assembled from a value —
        // `new RegExp(\`…${version}…\`)`. Hand-escaping is always incomplete
        // (the version-built pattern escaped dots and nothing else), and the
        // right answer is almost never a regex at all: parse the text and
        // compare data. A literal pattern, or one built from another literal,
        // is fine; one built from a variable has to say why with a disable
        // comment that names the guarantee.
        files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
        plugins: { regexp },
        rules: {
            'regexp/no-super-linear-backtracking': 'error',
            'regexp/no-super-linear-move': 'error',
            'no-restricted-syntax': ['error', ...REGEX_FROM_VALUE],
        },
    },
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
        files: ['packages/ui-vue/src/**/*.{ts,vue}'],
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
        files: ['packages/ui-vue/src/**/*.{ts,vue}'],
        ignores: ['packages/ui-vue/src/client/http/fetch-http-client.ts'],
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
        files: ['packages/ui-vue/src/client/*.ts'],
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
        files: ['packages/ui-vue/src/client/*/**/*.ts'],
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
        files: ['packages/ui-vue/src/vue/**/*.ts'],
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
                                '../pages/**',
                                '../layouts/**',
                                '../auth/**',
                                '../internal/**',
                                '../features/**',
                                '../ui/*/**',
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
        files: ['packages/ui-vue/src/index.ts'],
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
                            regex: '^\\./(?:pages/|layouts/|auth/|features/(?!bundle/internal/catalog-i18n\\.js$)|internal/(?!(?:dialogs/types|platform-email/platform-email\\.types|email-history/email-history\\.types)\\.js$)|ui/(?!theme/))',
                            message:
                                'The main entry may only re-export the whitelisted framework-free type/i18n modules from the SFC directories.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // `@saasicat/nest` has domains too, and until now nothing held them
        // apart. Two boundaries, and they are in ONE rule config on purpose:
        // flat config REPLACES a rule's options when a later object sets the
        // same rule, it does not merge them. Split across two objects, the
        // second silently deleted the first — the barrel pattern stopped
        // matching anywhere it applied, and `eslint .` stayed green while
        // guarding half of what it claimed. Both patterns therefore live
        // together, and the two blocks differ only in which files get the
        // second one.
        //
        // Boundary 1 — no barrel-to-barrel. Not a style question: the package
        // is bundled into twelve entry points, and a module pulled in through
        // `../billing/index.js` drags that whole barrel into whichever chunk
        // needed one symbol from it. That is how a class ends up with two
        // identities across two entries — the failure `_entries.cjs` and
        // `build-cjs-stubs.mjs` exist to undo — and how an ESM cycle starts.
        // Importing the module that declares the symbol costs one longer path
        // and removes both. Seven such imports existed when this rule was
        // written; it landed with none left, so there is no exemption list to
        // shrink.
        //
        // Boundary 2 — the direction of the arrow: `core <- {billing, catalog,
        // promo, discovery, entitlement, admin, setup, registration,
        // checkout-offer, subscription-contract} <- platform <- testing`.
        // A domain reaching back into `platform/` is the dependency pointing
        // the wrong way — what `forwardRef` is usually called in to paper over,
        // and this repository is at zero of those.
        files: ['packages/nest/src/**/*.ts'],
        ignores: ['packages/nest/src/platform/**', 'packages/nest/src/testing/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['../*/index.js', '../*/index.ts', '../../*/index.js'],
                            message:
                                'No barrel-to-barrel imports across nest domains — import the module that declares the symbol. ' +
                                'A barrel pulls its whole domain into the importing chunk, which duplicates class identities ' +
                                'across bundle entries and is the classic ESM cycle trigger.',
                        },
                        {
                            group: ['../platform/*', '../platform/**', '../../platform/**'],
                            message:
                                'Domain modules must not import from platform/ — platform composes them, not the other way round. ' +
                                'Move the shared piece down into core/, or let platform pass it in.',
                        },
                    ],
                },
            ],
        },
    },
    {
        // `platform/` composes the domains and `testing/` sits downstream of
        // `platform/`, so neither is subject to boundary 2 — but both are
        // subject to boundary 1, and it has to be restated here rather than
        // inherited, for the replace-not-merge reason above.
        files: ['packages/nest/src/platform/**/*.ts', 'packages/nest/src/testing/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['../*/index.js', '../*/index.ts', '../../*/index.js'],
                            message:
                                'No barrel-to-barrel imports across nest domains — import the module that declares the symbol. ' +
                                'A barrel pulls its whole domain into the importing chunk, which duplicates class identities ' +
                                'across bundle entries and is the classic ESM cycle trigger.',
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
            'packages/ui-vue/src/internal/dialogs/types.ts',
            'packages/ui-vue/src/features/bundle/internal/catalog-i18n.ts',
            'packages/ui-vue/src/internal/platform-email/platform-email.types.ts',
            'packages/ui-vue/src/internal/email-history/email-history.types.ts',
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
