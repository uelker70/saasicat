// BootLoader + ManifestLoader built from the same endpoint constant that
// `main.ts` passes to `createSuperAdminApp()` — endpoints live in exactly
// one place (handbook §8.1).

import { createPlatformLoaders, type SuperAdminEndpoints } from '@saasicat/ui-vue';
import { getAuthToken, platformHttp } from './http';

export const ADMIN_ENDPOINTS: SuperAdminEndpoints = { apiBase: '/api/v1/admin' };

export const loaders = createPlatformLoaders({
    endpoints: ADMIN_ENDPOINTS,
    http: platformHttp,
    storageKeyPrefix: 'notesapp:',
    getAuthToken,
});
