import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue';

import { cancellationLandsAt, subscriptionHasEnded } from './subscription-ended.js';
import type { CancellationTimestamps } from './subscription-ended.js';

// Whether the subscription has ended, kept true as the boundary passes.
//
// `subscriptionHasEnded(usage)` reads the clock, and a clock read inside a
// computed is not a dependency of it: a page left open across the effective
// moment goes on rendering the subscription as running, with its plan-change
// button, until something unrelated causes a reload. The date is the only thing
// that changes at that moment — no request arrives, no prop is written — so
// nothing else would invalidate it.
//
// So the moment is scheduled. One timer, armed only while a boundary is
// actually ahead, rearmed when the subscription changes, and cleared when the
// component goes away.

/**
 * `setTimeout` counts its delay in a signed 32-bit integer: anything above
 * this fires immediately instead of later, which for a cancellation a year out
 * would mean a timer that re-arms in a loop. Longer waits are taken in hops.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * True once the cancellation has taken effect, re-evaluated at that moment.
 *
 * @param usage A getter, so the caller may pass a ref, a prop or a store field.
 */
export function useSubscriptionHasEnded(
    usage: () => CancellationTimestamps | null | undefined,
): ComputedRef<boolean> {
    const observedAt = ref(Date.now());
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clear(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    // Watching the boundary rather than the whole subscription, and reading the
    // clock fresh inside: a page mounts before its data arrives, so the moment
    // this composable was created says nothing about the moment its subject
    // was. A component mounted on the 1st that loads a cancellation on the 10th
    // would otherwise measure a boundary on the 15th from the 1st — waiting
    // fourteen days for a five-day wait, and calling an ended subscription
    // running in the meantime.
    //
    // A `watch` on the date, not a `watchEffect`: this writes `observedAt`, and
    // an effect that reads what it writes re-runs itself for ever.
    /**
     * Arms the wait for `landsAt`, in hops where one is not enough.
     *
     * Recursive on purpose: the callback of a capped hop has not reached the
     * boundary, and nothing else would arm the next one — the watcher below
     * depends on the cancellation date, which has not changed. One hop and then
     * silence meant a boundary further out than a hop was never observed at
     * all.
     */
    function schedule(landsAt: string | null): void {
        clear();
        if (landsAt === null) return;
        const waitMs = new Date(landsAt).getTime() - Date.now();
        if (waitMs <= 0) return;
        timer = setTimeout(
            () => {
                timer = null;
                observedAt.value = Date.now();
                schedule(landsAt);
            },
            Math.min(waitMs, MAX_TIMEOUT_MS),
        );
    }

    watch(
        () => {
            const current = usage();
            return current ? cancellationLandsAt(current) : null;
        },
        (landsAt) => {
            observedAt.value = Date.now();
            schedule(landsAt);
        },
        { immediate: true },
    );

    onScopeDispose(clear);

    return computed(() => {
        const current = usage();
        return current ? subscriptionHasEnded(current, new Date(observedAt.value)) : false;
    });
}
