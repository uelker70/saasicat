// Whether tenants are locked out right now, for the banner every page of the
// administration shows while they are (`SC-ADM-030`).
//
// A lock ends only when somebody unlocks, so an operator who forgets is told
// wherever they are rather than only on the maintenance page. The shell asks
// on mount and then every `intervalMs`, and stops asking when it unmounts or
// when there is no resource to ask — the installation keeps no windows.

import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { MaintenanceWindowView } from '@saasicat/core';

import type { MaintenanceResource } from './use-maintenance.js';

/** How often the shell asks; a lock's banner is at most this late. */
export const MAINTENANCE_WATCH_INTERVAL_MS = 30_000;

export interface MaintenanceLockWatch {
    /** The locked window, or null while nothing is locked or nothing is known. */
    locked: Ref<MaintenanceWindowView | null>;
    /** Asks now, rather than at the next interval. */
    refresh(): Promise<void>;
}

export function useMaintenanceLockWatch(
    maintenance: Ref<MaintenanceResource | null>,
    intervalMs: number = MAINTENANCE_WATCH_INTERVAL_MS,
): MaintenanceLockWatch {
    const locked = ref<MaintenanceWindowView | null>(null);
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh(): Promise<void> {
        const resource = maintenance.value;
        if (!resource) return;
        try {
            const { open } = await resource.overview();
            locked.value = open?.status === 'locked' ? open : null;
        } catch {
            // The banner keeps what it last knew. A failed read is shown where
            // it can be acted on — the maintenance page's own error banner —
            // and a toast every thirty seconds from a strip at the top would
            // bury everything else on the screen.
        }
    }

    function stop(): void {
        if (timer !== null) clearInterval(timer);
        timer = null;
    }

    watch(
        maintenance,
        (resource) => {
            stop();
            if (!resource) {
                locked.value = null;
                return;
            }
            void refresh();
            timer = setInterval(() => void refresh(), intervalMs);
        },
        { immediate: true },
    );
    onScopeDispose(stop);

    return { locked, refresh };
}
