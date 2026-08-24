import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    base: '/admin/',
    plugins: [
        vue(),
    ],
    // Exactly one copy of each of these, always.
    //
    // `createSuperAdminApp()` CREATES the router, the Pinia instance and the
    // Quasar plugin; this app's own pages then consume them through
    // `useRoute()`, `useRouter()` and store hooks. Those APIs work by module
    // identity — `provide`/`inject` with a key that is a module-level symbol —
    // so two copies of the library do not share one, and the lookup silently
    // returns `undefined`.
    //
    // The platform ships its pages as `.vue` SOURCE (decision E3), so their
    // `import … from 'vue-router'` resolves relative to the platform package,
    // while this app's own files resolve relative to here. Without dedupe the
    // bundle ends up with both, and every consumer page that reads a route
    // param throws `Cannot read properties of undefined (reading 'params')` —
    // the shell renders, the content area is blank.
    //
    // The list is `@saasicat/ui-vue`'s peerDependencies: a peer is precisely a
    // dependency the host is expected to own exactly one of.
    resolve: {
        dedupe: ['vue', 'vue-router', 'pinia'],
    },
    server: {
        port: __DEV_PORT__,
        proxy: {
            '/api': {
                target: 'http://localhost:__BACKEND_PORT__',
                changeOrigin: true,
            },
        },
    },
});
