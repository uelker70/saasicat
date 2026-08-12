import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar } from '@quasar/vite-plugin';

// Ports come from `examples/notesapp/.env` — the same file docker compose reads,
// so the dev server and the container stack cannot disagree about them.
//
// They are read from the FILE, not from `process.env`. `pnpm dev` in this
// directory does not load the parent `.env`, and a hardcoded fallback is how
// this bites: the fallback used to be 3000, which on a machine running the
// other consumer stacks is somebody else's API. The admin then talked to a
// foreign backend and got `401 {"code":"NO_BEARER_TOKEN"}` — an error message
// that describes a real problem in an app you are not looking at.
const env = loadEnv('development', fileURLToPath(new URL('..', import.meta.url)), '');

/** Host port the notesapp API is published on. Must match `.env`. */
const BACKEND_HOST_PORT = env.BACKEND_HOST_PORT ?? '4000';
/** Host port the admin is served on, container or dev server. Must match `.env`. */
const ADMIN_HOST_PORT = Number(env.ADMIN_HOST_PORT ?? 9900);

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
