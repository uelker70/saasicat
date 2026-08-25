import { computed, onScopeDispose, ref, watchEffect, type ComputedRef } from 'vue';

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

    watchEffect(() => {
        clear();
        const current = usage();
        if (!current) return;
        const landsAt = cancellationLandsAt(current);
        if (landsAt === null) return;
        const waitMs = new Date(landsAt).getTime() - observedAt.value;
        if (waitMs <= 0) return;
        timer = setTimeout(
            () => {
                timer = null;
                observedAt.value = Date.now();
            },
            Math.min(waitMs, MAX_TIMEOUT_MS),
        );
    });

    onScopeDispose(clear);

    return computed(() => {
        const current = usage();
        return current ? subscriptionHasEnded(current, new Date(observedAt.value)) : false;
    });
}
