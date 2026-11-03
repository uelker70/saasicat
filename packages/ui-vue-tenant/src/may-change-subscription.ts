// Whether the reader may change what the tenant pays — the plan, the add-ons
// and the versions they are on (`SC-ADM-026`).
//
// The server says so beside the subscription, and the page that reads it
// provides it once. Every action below it that has no preview of its own —
// cancelling, reactivating, taking a newer version, switching away from a
// retired one — shows itself only where the reader may make it, rather than
// leading anybody else to a refusal. An action with a preview leaves it to the
// preview, which says the same thing beside what the change would cost.

import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';

const MAY_CHANGE_SUBSCRIPTION_KEY: InjectionKey<ComputedRef<boolean>> = Symbol.for(
    'saasicat/ui-vue-tenant/MAY_CHANGE_SUBSCRIPTION',
);

/** Where nothing was provided the reader may, as before the server said. */
const MAY = computed(() => true);

/**
 * Makes known below whether the reader may change the subscription, and
 * answers it for the page that provides it. Only a server's `false` withholds
 * the actions; where it does not say, as one that predates it, they stay.
 */
export function provideMayChangeSubscription(
    mayChange: () => boolean | undefined,
): ComputedRef<boolean> {
    const may = computed(() => mayChange() !== false);
    provide(MAY_CHANGE_SUBSCRIPTION_KEY, may);
    return may;
}

/** What was provided above. */
export function useMayChangeSubscription(): ComputedRef<boolean> {
    return inject(MAY_CHANGE_SUBSCRIPTION_KEY, MAY);
}
