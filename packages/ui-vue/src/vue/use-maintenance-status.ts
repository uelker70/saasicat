// What a tenant's page is told about maintenance: nothing, a window ahead, or
// a lock — read from `GET <apiBase>/public/maintenance`, which answers while
// the lock holds and to somebody not yet signed in.
//
// Asked on mount and then on a timer: every `pollMs` while nothing is locked,
// every `lockedPollMs` while it is, so the page notices by itself when the lock
// is lifted and the tenant carries on where they were (`SC-UI-026`). A refusal
// the application reports switches to the lock at once, and remembers that a
// request was refused, so the page can say so.

import { onScopeDispose, ref, type Ref } from 'vue';
import type { MaintenanceStatusView } from '@saasicat/core';

import { onMaintenanceRefusal } from '../client/maintenance-refusal.js';
import { trimTrailingSlashes } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

/** How often the status is asked while nothing is locked. */
export const MAINTENANCE_STATUS_POLL_MS = 60_000;
/** How often while the lock holds: the tenant is waiting for exactly this answer. */
export const MAINTENANCE_LOCKED_POLL_MS = 15_000;

export interface UseMaintenanceStatusOptions {
    http?: HttpClient;
    /** Where the platform's routes are mounted, such as `/api`. Default: the origin's root. */
    apiBase?: string;
    pollMs?: number;
    lockedPollMs?: number;
}

export interface MaintenanceStatusState {
    /** `none` until the first answer, and where the installation keeps no windows. */
    status: Ref<MaintenanceStatusView>;
    /** Whether a request of the page was refused by the lock since it began. */
    refused: Ref<boolean>;
    refresh(): Promise<void>;
}

function isStatus(value: unknown): value is MaintenanceStatusView {
    const state = (value as { state?: unknown } | null)?.state;
    return state === 'none' || state === 'announced' || state === 'locked';
}

export function useMaintenanceStatus(
    options: UseMaintenanceStatusOptions = {},
): MaintenanceStatusState {
    const http = options.http ?? defaultHttpClient();
    const url = `${trimTrailingSlashes(options.apiBase ?? '')}/public/maintenance`;
    const pollMs = options.pollMs ?? MAINTENANCE_STATUS_POLL_MS;
    const lockedPollMs = options.lockedPollMs ?? MAINTENANCE_LOCKED_POLL_MS;

    const status = ref<MaintenanceStatusView>({ state: 'none' });
    const refused = ref(false);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    // Moved by every reported refusal. A poll started before one may answer
    // after it — from a process still serving its answer from before the lock —
    // and must not put back what the refusal just replaced.
    let generation = 0;

    function schedule(): void {
        if (timer !== null) clearTimeout(timer);
        if (disposed) return;
        const delay = status.value.state === 'locked' ? lockedPollMs : pollMs;
        timer = setTimeout(() => void refresh(), delay);
    }

    async function refresh(): Promise<void> {
        const askedAt = generation;
        try {
            const response = await http(url);
            if (response.status === 200) {
                const body: unknown = await response.json();
                if (isStatus(body) && askedAt === generation) {
                    status.value = body;
                    if (body.state !== 'locked') refused.value = false;
                }
            }
            // Anything else — a 404 where the installation keeps no windows,
            // a proxy's error page — leaves what was known standing: a page
            // that cannot ask is not told the lock was lifted.
        } catch {
            // Offline, or the server is restarting inside the window. The
            // answer that was known stands, and the next tick asks again.
        } finally {
            schedule();
        }
    }

    const stopHearing = onMaintenanceRefusal((locked) => {
        generation += 1;
        status.value = locked;
        refused.value = true;
        schedule();
    });

    void refresh();
    onScopeDispose(() => {
        disposed = true;
        if (timer !== null) clearTimeout(timer);
        stopHearing();
    });

    return { status, refused, refresh };
}
