import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar } from '@quasar/vite-plugin';

export default defineConfig({
    // Served at the origin root rather than under /admin/: the admin is the
    // whole frontend of this example, and its `/login` route sits outside the
    // /admin path, so a subpath base would leave the login page unreachable.
    base: '/',
    plugins: [
        vue(),
        quasar({
            // Absolute path — sass resolves plain relative paths against the
            // importing file inside node_modules/quasar, not the project root.
            sassVariables: fileURLToPath(new URL('./src/styles/theme.scss', import.meta.url)),
        }),
    ],
    // The admin renders `@saasicat/ui-vue`'s pages from source through the
    // package's `./pages/*` subpath. Excluding it from pre-bundling is what
    // makes editing a platform page hot-reload here instead of requiring a
    // rebuild — a pre-bundled dependency is a frozen snapshot.
    optimizeDeps: {
        exclude: ['@saasicat/ui-vue', '@saasicat/types'],
    },
    server: {
        // 9100 and 9101 are taken by the vereinsfux and autohauspro admin
        // containers on this machine; without a fixed free port Vite picks a
        // different one on every start.
        // Same port the compose stack publishes the admin on, so the URL does
        // not change with how it is served. They are alternatives, not
        // neighbours — stop the admin container first.
        port: Number(process.env.ADMIN_HOST_PORT ?? 9900),
        strictPort: true,
        proxy: {
            // The compose stack publishes the backend on BACKEND_HOST_PORT
            // (4000 by default, see examples/notesapp/.env) — not on the
            // container-internal 3000.
            '/api': {
                target: `http://localhost:${process.env.BACKEND_HOST_PORT ?? '3000'}`,
                changeOrigin: true,
            },
        },
        // The package is a workspace symlink; without this Vite refuses to
        // serve files from outside the app root.
        fs: {
            allow: [fileURLToPath(new URL('../../..', import.meta.url))],
        },
    },
});
