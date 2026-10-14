import { defineConfig } from 'oxlint';

// The second general linter next to ESLint: only the `correctness` category,
// that is, code that is very likely wrong or useless. Every finding fails
// `pnpm run lint:correctness`; there is no baseline.
//
// Separate from `oxlint.config.mts` because the anti-slop ratchet treats every
// finding outside its plugin as an error — a shared configuration would stop
// it at the first `correctness` finding.
//
// The other categories stay off: `suspicious` and `pedantic` report taste and
// style, ESLint holds this repository's own rules, and formatting belongs to
// Prettier. No test plugin (`jest`, `vitest`): every package tests with
// `node --test`.
export default defineConfig({
    // A category only switches on the rules of active plugins. `plugins`
    // replaces the default set, so its three are listed here; `vue` is added so
    // single-file components are not read as plain scripts. The core rules
    // (`eslint`) are always active.
    plugins: ['typescript', 'unicorn', 'oxc', 'vue'],
    categories: {
        correctness: 'error',
    },
    // Switches on the rules that need types: a promise nobody waits for
    // (`no-floating-promises`), an `await` on something that is not one
    // (`await-thenable`), an object that ends up as "[object Object]" in a text
    // (`no-base-to-string`). `oxlint-tsgolint` reads the types from the
    // `tsconfig.json` next to each file, after `pnpm -r build` — before it, the
    // packages' own imports resolve to nothing. A tsconfig it cannot read turns
    // them off silently; it builds on TypeScript 7 and refuses
    // `moduleResolution: "node10"`. Single-file components it does not read:
    // in `.vue` only the rules without types apply.
    // `scripts/oxlint-gegenprobe.mts` holds all three.
    options: {
        typeAware: true,
    },
    rules: {
        // `describe`, `it` and `test` from `node:test` return a promise the
        // runner waits for itself. Without the exception the rule would report
        // every test block; a forgotten `await` *inside* a test it still reports.
        'typescript/no-floating-promises': [
            'error',
            {
                allowForKnownSafeCalls: [
                    { from: 'package', package: 'node:test', name: ['describe', 'it', 'test'] },
                ],
            },
        ],
        // Reports `{ ...dto }` and `[...text]` by type alone. A DTO arrives from
        // the `ValidationPipe` as a class instance and is taken apart into a
        // plain object on purpose; its methods are meant to stay behind.
        // `[...text]` yields code points — whether that is right depends on
        // whether characters or graphemes are meant, which the rule cannot see.
        'typescript/no-misused-spread': 'off',
    },
    overrides: [
        {
            // The tests are JavaScript against the built packages, and
            // JavaScript has no tuples: `for (const [field, change] of [['value',
            // { value: null }]])` gives `field` the type `string | { value: null
            // }`. On that guess four rules report what the code does not say — a
            // table's name as "[object Object]", a helper's method as unbound, a
            // list of ids as unsortable. The other rules with types stay on, a
            // forgotten `await` above all.
            files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
            rules: {
                'typescript/restrict-template-expressions': 'off',
                'typescript/no-base-to-string': 'off',
                'typescript/unbound-method': 'off',
                'typescript/require-array-sort-compare': 'off',
            },
        },
    ],
    ignorePatterns: ['tools/oxlint/anti-slop/**'],
});
