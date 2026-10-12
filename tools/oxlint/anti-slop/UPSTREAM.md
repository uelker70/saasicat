# Provenance

Copied from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit
`c44ef22` of 2026-09-10, under the MIT licence in [`LICENSE`](LICENSE).
`vendor/eslint-stylistic/` carries its own licence.

Upstream publishes no npm package; the plugin is meant to be copied. This is
`src/` without the tests (`*.test.ts`) and without `effect/`, which only
concerns projects that use Effect. The code is unchanged apart from the one
deviation below. Added is `package.json` with `"type": "module"`, as upstream
declares it — otherwise Node warns on every run that it has to parse the module
twice.

One deviation from upstream: `rules/no-module-mocking.ts` also recognises
`jest.setMock(…)`, which replaces a module just the same; upstream lacks it in
both spellings (`jest.setMock` and `jest["setMock"]`). Keep it when updating,
as long as upstream does not know it itself.

Which rules are active, and why, is stated in `oxlint.config.mts` at the
repository root. The plugin needs `oxlint` and `@oxlint/plugins` at the
**same** exact version; both are in the root `package.json`.

To update: copy upstream `src/` again (without tests and `effect/`), adjust the
commit and date above, then run `node scripts/anti-slop-ratchet.mts` — a
changed rule can move the numbers.
