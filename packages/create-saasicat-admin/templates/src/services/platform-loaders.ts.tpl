// BootLoader + ManifestLoader built from the same endpoint constant that
// `main.ts` passes to `createSuperAdminApp()` — endpoints live in exactly
// one place (handbook §8.1).

import { createPlatformLoaders, type SuperAdminEndpoints } from '@saasicat/ui-vue';
import { getAuthToken, platformHttp } from './http';

// `projectKey` names the catalogue this admin administers — the same key your
// backend configuration uses. The shell hands it to every platform resource,
// so a catalogue page does not have to carry it as a prop.
export const ADMIN_ENDPOINTS: SuperAdminEndpoints = {
    apiBase: '__API_BASE__',
    projectKey: '__PROJECT_KEY__',
};

export const loaders = createPlatformLoaders({
    endpoints: ADMIN_ENDPOINTS,
    http: platformHttp,
    storageKeyPrefix: '__PROJECT_KEY__:',
    getAuthToken,
});
