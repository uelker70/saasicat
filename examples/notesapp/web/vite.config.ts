import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar } from '@quasar/vite-plugin';

export default defineConfig({
    // Tenant-facing app served at the origin root.
    base: '/',
    plugins: [
        vue(),
        quasar({
            // Absolute path — sass resolves plain relative paths against the
            // importing file inside node_modules/quasar, not the project root.
            sassVariables: fileURLToPath(new URL('./src/styles/theme.scss', import.meta.url)),
        }),
    ],
    // Exactly one copy of each of these, always.
    //
    // `platform CREATES Quasar and Pinia instances this app's own pages then consume them through
    // `useRoute()`, `useRouter()` and store hooks. Those APIs work by module
    // identity — `provide`/`inject` with a key that is a module-level symbol —
    // so two copies of the library do not share one, and the lookup silently
    // returns `undefined`.
    //
    // The platform ships its pages as `.vue` SOURCE (decision E3), so their
    // `import … from 'vue-router'` resolves relative to the platform package,
    // while this app's own files resolve relative to here. Without dedupe the
    // bundle ends up with both, and a tenant page that reads a store or a
    // route resolves against a provider that never ran.
    //
    // The list is `@saasicat/ui-vue`'s peerDependencies: a peer is precisely a
    // dependency the host is expected to own exactly one of.
    resolve: {
        dedupe: ['vue', 'vue-router', 'pinia', 'quasar'],
    },
    server: {
        port: 9200,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
