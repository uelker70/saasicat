// useActions — Vue-3-Composable über ActionRegistry.
//
// Wrappt einen reaktiven `Ref<AdminManifest | null>` und einen statischen
// `actions:`-Map (Konsumenten-Shell-Build) und liefert ein reaktives
// Registry-Object, das automatisch neu aufgebaut wird, sobald sich das
// Manifest ändert (z. B. nach `manifest reload`).

import { computed, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import { ActionRegistry, type ActionHandler } from './action-registry.js';

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
