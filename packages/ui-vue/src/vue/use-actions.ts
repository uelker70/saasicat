// useActions — Vue 3 composable over ActionRegistry.
//
// Wraps a reactive `Ref<AdminManifest | null>` and a static
// `actions:` map (consumer shell build) and returns a reactive
// registry object that is automatically rebuilt as soon as the
// manifest changes (e.g. after `manifest reload`).

import { computed, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import { ActionRegistry, type ActionHandler } from '../client/action-registry.js';

export interface UseActionsResult {
    registry: ComputedRef<ActionRegistry | null>;
}

export function useActions(
    manifest: Ref<AdminManifest | null>,
    actions: Record<string, ActionHandler>,
): UseActionsResult {
    const registry = computed<ActionRegistry | null>(() => {
        if (!manifest.value) return null;
        return new ActionRegistry(manifest.value, actions);
    });
    return { registry };
}
