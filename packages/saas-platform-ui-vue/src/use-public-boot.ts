// usePublicBoot — Vue 3 composable over BootLoader.
//
// Usage in the login layout:
//
//     const { boot, loading, error, load } = usePublicBoot();
//     await load();
//     // boot.value now contains project.{key,displayName,logoUrl}.

import { ref, type Ref } from 'vue';
import type { PublicBootResponse } from '@saasicat/types';
import { BootLoader, type BootLoaderOptions } from './boot-loader.js';

export interface UsePublicBootResult {
    boot: Ref<PublicBootResponse | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    load: () => Promise<void>;
}

export function usePublicBoot(options: BootLoaderOptions): UsePublicBootResult {
    const loader = new BootLoader(options);
    const boot = ref<PublicBootResponse | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            boot.value = await loader.load();
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            boot.value = null;
        } finally {
            loading.value = false;
        }
    }

    return { boot, loading, error, load };
}
