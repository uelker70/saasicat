import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar } from '@quasar/vite-plugin';

export default defineConfig({
    base: '/admin/',
    plugins: [vue(), quasar({ sassVariables: 'src/styles/theme.scss' })],
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
