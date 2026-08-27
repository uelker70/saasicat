// BootLoader + ManifestLoader built from the same endpoint constant that
// `main.ts` passes to `createSuperAdminApp()` — endpoints live in exactly
// one place (docs/guides/build-the-admin-frontend.md, "Platform Loaders").

import { createPlatformLoaders, type SuperAdminEndpoints } from '@saasicat/ui-vue';
import { platformHttp } from './http';

export const ADMIN_ENDPOINTS: SuperAdminEndpoints = {
    apiBase: '/api/v1/admin',
};

export const loaders = createPlatformLoaders({
    endpoints: ADMIN_ENDPOINTS,
    http: platformHttp,
    storageKeyPrefix: 'notesapp:',
});
