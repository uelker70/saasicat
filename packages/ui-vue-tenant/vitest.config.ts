import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Component tests for the tenant-facing SFCs. The package ships source only, so
// there is no `dist/` for a `node --test` suite to import — this runner is the
// package's whole test surface, and it is scoped to `tests/component/`.
//
// The Quasar alias is the same one `@saasicat/ui-vue` needs: Quasar's export
// map sends a Node resolver to the server build, whose install() expects an
// SSR context.
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            quasar: fileURLToPath(
                new URL('./node_modules/quasar/dist/quasar.client.js', import.meta.url),
            ),
        },
    },
    test: {
        include: ['tests/component/**/*.test.ts'],
        environment: 'jsdom',
        root: fileURLToPath(new URL('.', import.meta.url)),
        server: { deps: { inline: ['quasar'] } },
    },
});
