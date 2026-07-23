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
