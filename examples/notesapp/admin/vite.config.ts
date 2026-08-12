import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar } from '@quasar/vite-plugin';

// Ports come from `examples/notesapp/.env` — the same file docker compose reads,
// so the dev server and the container stack cannot disagree about them.
//
// Read from the FILE, not from `process.env`: `pnpm dev` in this directory does
// not load the parent `.env`, so without this the dev server silently used the
// built-in fallback while the compose stack published somewhere else. On a
// machine where another project already occupies the default, the admin then
// proxies to a FOREIGN backend — which answers `401` with an error code from an
// application you are not looking at.
//
// The fallbacks mirror `docker-compose.yml`'s own defaults on purpose. A
// divergent number here would reintroduce exactly the split this fixes, just
// one level up; machine-specific ports belong in `.env`, not in the config.
const env = loadEnv('development', fileURLToPath(new URL('..', import.meta.url)), '');

/** Mirrors `${BACKEND_HOST_PORT:-3000}` in docker-compose.yml. */
const BACKEND_HOST_PORT = env.BACKEND_HOST_PORT ?? '3000';
/** Mirrors `${ADMIN_HOST_PORT:-9000}` in docker-compose.yml. */
const ADMIN_HOST_PORT = Number(env.ADMIN_HOST_PORT ?? 9000);

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
        // Same port the compose stack publishes the admin on, so the URL does
        // not change with how it is served. They are alternatives, not
        // neighbours — stop the admin container first.
        port: ADMIN_HOST_PORT,
        strictPort: true,
        proxy: {
            '/api': {
                target: `http://localhost:${BACKEND_HOST_PORT}`,
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
