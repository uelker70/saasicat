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
    // Unchanged copy of a third-party plugin (provenance in UPSTREAM.md next to it).
    ignorePatterns: ['tools/oxlint/anti-slop/**'],
});
