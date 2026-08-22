// BootLoader + ManifestLoader built from the same endpoint constant that
// `main.ts` passes to `createSuperAdminApp()` — endpoints live in exactly
// one place (handbook §8.1).

import { createPlatformLoaders, type SuperAdminEndpoints } from '@saasicat/ui-vue';
import { platformHttp } from './http';

// `projectKey` names the catalogue this admin administers — the same key the
// seed and `config/saas.yaml` use. The shell hands it to every platform
// resource, so a catalogue page does not have to carry it as a prop.
export const ADMIN_ENDPOINTS: SuperAdminEndpoints = {
    apiBase: '/api/v1/admin',
    projectKey: 'notesapp',
};

export const loaders = createPlatformLoaders({
    endpoints: ADMIN_ENDPOINTS,
    http: platformHttp,
    storageKeyPrefix: 'notesapp:',
});
