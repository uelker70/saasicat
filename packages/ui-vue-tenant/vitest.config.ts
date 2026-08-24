import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Component tests for the tenant-facing SFCs. The package ships source only, so
// there is no `dist/` for a `node --test` suite to import — this runner is the
// package's whole test surface, and it is scoped to `tests/component/`.
//
// No Quasar alias any more, and its absence is the point: this package renders
// with Vue and the theme's custom properties. The alias was here because
// Quasar's export map sends a Node resolver to its server build, whose
// `install()` expects an SSR context — a problem that only exists for someone
// who loads Quasar.
export default defineConfig({
    plugins: [vue()],
    test: {
        include: ['tests/component/**/*.test.ts'],
        environment: 'jsdom',
        root: fileURLToPath(new URL('.', import.meta.url)),
    },
});
