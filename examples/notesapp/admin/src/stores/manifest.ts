// Manifest Pinia store — the router guard in `main.ts` awaits
// `ensureLoaded()` before rendering admin routes (handbook §8.2).

import { createManifestStore } from '@saasicat/ui-vue';
import { loaders } from '../services/platform-loaders';

export const useManifestStore = createManifestStore({
    loader: loaders.manifestLoader,
    id: 'admin-manifest',
});
