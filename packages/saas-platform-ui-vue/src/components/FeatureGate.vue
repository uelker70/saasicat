<template>
    <template v-if="visible">
        <slot />
    </template>
    <template v-else>
        <slot name="fallback" />
    </template>
</template>

<script setup lang="ts">
// FeatureGate — declarative show/hide component based on Entitlement.
//
// Usage:
//
// ```vue
// <FeatureGate feature="DMS">
//     <DmsLink />
// </FeatureGate>
//
// <FeatureGate :feature="['DMS', 'STORAGE_PRO']">
//     <Hochladen />
//     <template #fallback>
//         <UpgradeHinweis />
//     </template>
// </FeatureGate>
// ```
//
// Multiple features → logical OR (as soon as **one** is in the plan, the
// default slot is rendered). Identical to `@RequireFeature(...)` in the backend.
//
// Prerequisite: `provideEntitlement(app, ent)` in the app bootstrap. Without a
// provider the component renders the default slot (fail-open in dev mode,
// console warning). Apps that want stricter behavior set
// `strictMode: true` in the provider — then `useInjectedEntitlement` throws
// instead of returning `null`. (Strict mode comes later; currently default = lenient.)

import { computed } from 'vue';
import { useInjectedEntitlement } from '../vue/entitlement-provider.js';

interface Props {
    /** A single FeatureKey or several as a logical OR. */
    feature: string | readonly string[];
}

const props = defineProps<Props>();
const ent = useInjectedEntitlement();

const visible = computed<boolean>(() => {
    if (!ent) {
        // No provider — dev fallback: render.
        return true;
    }
    const required = Array.isArray(props.feature) ? props.feature : [props.feature];
    return required.some((f) => ent.hasFeature(f));
});
</script>
