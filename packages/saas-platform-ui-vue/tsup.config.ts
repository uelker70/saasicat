import { defineConfig } from 'tsup';

// Three bundled entries, one per layer (the Quasar SFC pages are shipped as
// raw src/ via subpath exports, not bundled):
//   dist/index.*        — main entry: client re-exports + Vue layer, Quasar-free
//   dist/client/index.* — framework-free core only
//   dist/quasar/index.* — createSuperAdminApp + Quasar notify port
export default defineConfig([
    {
        entry: {
            index: 'src/index.ts',
            'client/index': 'src/client/index.ts',
            'quasar/index': 'src/quasar/index.ts',
        },
        format: ['esm', 'cjs'],
        dts: true,
        clean: true,
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
