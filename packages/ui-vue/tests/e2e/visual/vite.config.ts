import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { quasar } from '@quasar/vite-plugin';
import { defineConfig } from 'vite';

// Fixture app for the visual baselines.
//
// It exists to render each platform page in a REAL browser with the real
// stylesheet cascade, which is the only place `getComputedStyle` tells the
// truth — jsdom resolves almost nothing from a stylesheet, so vitest cannot
// answer "did this change look different".
//
// Everything the pages would fetch is stubbed in `main.ts`; no backend, no
// network, no clock.
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [
        vue(),
        // No `sassVariables`. Since phase 8 the admin ships Quasar compiled, so
        // a consumer's palette is written at runtime by the brand bridge and
        // never through Sass. A fixture that brands itself in Sass would bake
        // in colours no app can produce, and the baselines would record them.
        quasar(),
    ],
    resolve: {
        alias: [
            {
                // Exact match only. A plain string alias matches by prefix and
                // would swallow `quasar/src/css/index.sass` too, which is how
                // the stylesheet silently stops loading — and a baseline taken
                // from an unstyled page proves nothing.
                find: /^quasar$/,
                replacement: fileURLToPath(
                    new URL('../../../node_modules/quasar/dist/quasar.client.js', import.meta.url),
                ),
            },
        ],
    },
    server: { port: 5175, strictPort: true },
    preview: { port: 5175, strictPort: true },
});
