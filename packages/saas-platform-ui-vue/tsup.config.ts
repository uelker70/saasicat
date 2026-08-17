import { defineConfig } from 'tsup';

// Three bundled entries, one per layer (the Quasar SFC pages are shipped as
// raw src/ via subpath exports, not bundled):
//   dist/index.*        — main entry: client re-exports + Vue layer, Quasar-free
//   dist/client/index.* — framework-free core only
//   dist/quasar/index.* — createSuperAdminApp + Quasar notify port
//
// NOTE: no `clean: true` on any entry. tsup runs the two configs below
// concurrently, so a `clean` belonging to one of them deletes whatever the
// other has already written. That is not hypothetical: it silently removed
// `dist/testing-e2e/*.d.ts` after the declaration build had emitted them,
// which left `package.json#exports` pointing its `types` condition at files
// that did not exist.
//
// Nothing empties `dist/` up front either: the `build` script runs tsup
// through `scripts/build-and-prune.mjs`, which removes outputs this build did
// not write once it has finished. Emptying first left a window — 12.5 s for
// this package, the longest in the repo — in which the JS bundles existed and
// the declarations did not, which a TypeScript server can observe and then
// cache as an unresolvable module.
export default defineConfig([
    {
        entry: {
            index: 'src/index.ts',
            'client/index': 'src/client/index.ts',
            'quasar/index': 'src/quasar/index.ts',
        },
        format: ['esm', 'cjs'],
        dts: true,
        external: ['@saasicat/types', 'vue', 'vue-router', 'pinia', 'quasar'],
    },
    {
        entry: { 'admin-pages-suite': 'src/testing-e2e/admin-pages-suite.ts' },
        outDir: 'dist/testing-e2e',
        format: ['esm', 'cjs'],
        dts: true,
        external: ['@playwright/test'],
    },
]);
