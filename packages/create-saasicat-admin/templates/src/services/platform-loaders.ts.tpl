// BootLoader + ManifestLoader built from the same endpoint constant that
// `main.ts` passes to `createSuperAdminApp()` — endpoints live in exactly
// one place (docs/guides/build-the-admin-frontend.md, "Platform Loaders").

import { createPlatformLoaders, type SuperAdminEndpoints } from '@saasicat/ui-vue';
import { platformHttp } from './http';

export const ADMIN_ENDPOINTS: SuperAdminEndpoints = {
    apiBase: '__API_BASE__',
};

export const loaders = createPlatformLoaders({
    endpoints: ADMIN_ENDPOINTS,
    http: platformHttp,
    storageKeyPrefix: '__APP_KEY__:',
});
