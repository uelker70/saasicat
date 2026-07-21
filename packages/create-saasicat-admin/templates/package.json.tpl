{
    "name": "__PROJECT_KEY__-admin",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "scripts": {
        "dev": "vite",
        "build": "vue-tsc -b && vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "@quasar/extras": "^1.16.0",
        "@saasicat/types": "__PLATFORM_VERSION__",
        "@saasicat/ui-vue": "__PLATFORM_VERSION__",
        "axios": "^1.15.0",
        "pinia": "^3.0.0",
        "quasar": "^2.18.0",
        "vue": "^3.5.0",
        "vue-router": "^4.5.0"
    },
    "devDependencies": {
        "@quasar/vite-plugin": "^1.10.0",
        "@vitejs/plugin-vue": "^6.0.0",
        "sass": "^1.83.0",
        "typescript": "^5.7.0",
        "vite": "^7.0.0",
        "vue-tsc": "^2.2.0"
    }
}
