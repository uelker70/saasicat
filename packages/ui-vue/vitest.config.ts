import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Component tests for the SFCs. The framework-free units keep running on
// `node --test` against the built `dist/` — this runner exists only because a
// `.vue` file needs compiling, and it is scoped to `tests/component/` so the
// two never overlap.
//
// The SFCs are consumed from `src/` by design (see the package exports), so the
// tests import them the same way a consumer's bundler does.
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            // Quasar's export map sends any Node resolver to `quasar.server.*`,
            // and that build's install() expects an SSR context — it dies with
            // "Cannot convert undefined or null to object". Vitest runs in Node
            // even with jsdom, so the client build has to be named outright;
            // export conditions are not enough to outrank `node`.
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
