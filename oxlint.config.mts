import { defineConfig } from 'oxlint';

// This configuration serves only the anti-slop rules from
// `tools/oxlint/anti-slop/` (provenance in `UPSTREAM.md` next to it). The
// built-in categories are off: it counts exactly the rules below. ESLint stays
// this repository's general linter; oxlint's `correctness` run lives in
// `oxlint.correctness.config.mts` (`pnpm run lint:correctness`).
//
// `scripts/anti-slop-ratchet.mts` counts every rule here against
// `anti-slop-ratchet.json`. "error" therefore means "counted", not "fails on
// the first finding": existing findings stay until somebody touches that code,
// and the number may only go down.
//
// The plugin's other rules are deliberately off:
// - `no-unknown-parameters`, `no-unknown-returns`, `no-runtime-typeof` demand a
//   schema at every boundary. Here a genuinely open type is `unknown` plus
//   narrowing — exactly what those rules forbid.
// - `require-readable-spacing` is formatting, and formatting belongs to Prettier.
// - `no-array-filter-map`, `no-shape-in-symbol-names`, `no-object-parameters`,
//   `no-known-value-widening`, `no-unknown-type-aliases`,
//   `no-reduce-accumulator-copy` are the author's taste, not a rule of this
//   repository.
export default defineConfig({
    plugins: [],
    categories: {
        correctness: 'off',
        suspicious: 'off',
        pedantic: 'off',
        style: 'off',
        restriction: 'off',
        perf: 'off',
        nursery: 'off',
    },
    jsPlugins: ['./tools/oxlint/anti-slop/index.ts'],
    ignorePatterns: ['tools/oxlint/anti-slop/**'],
    rules: {
        // A type assertion claims what the compiler cannot check. The reason goes
        // right before it: `// SAFETY: <what makes it true>`.
        'anti-slop/require-safety-comment-for-type-assertion': 'error',
        // `x as unknown as T` switches type checking off instead of passing it.
        'anti-slop/no-chained-type-assertions': 'error',
        // The same in two steps: widen to `unknown` first, assert it back later.
        'anti-slop/no-widen-then-assert': 'error',
        // `Reflect.get` and `Reflect.apply` bypass the type of the property or function.
        // The one legitimate case the rule cannot tell apart: the `get` trap of a
        // Proxy that forwards with `Reflect.get(target, name, receiver)` so that
        // getters see the right receiver. There an `oxlint-disable-next-line`
        // for exactly this rule carries the reason after `--`, and the
        // `disable-directive` number in `anti-slop-ratchet.json` goes up by one,
        // by hand.
        'anti-slop/no-reflect-get': 'error',
        'anti-slop/no-reflect-apply': 'error',
        // A module mock swaps a dependency behind the code's back; a test gets it
        // through a seam the code itself uses.
        'anti-slop/no-module-mocking': 'error',
        // A dictionary with `unknown`, `any` or `object` as its value says
        // nothing about what is in it.
        'anti-slop/no-unsafe-dictionary-type': 'error',
        // `...(c ? { a } : {})` hides whether a field is absent or `undefined`.
        'anti-slop/no-conditional-empty-object-spread': 'error',
    },
});
