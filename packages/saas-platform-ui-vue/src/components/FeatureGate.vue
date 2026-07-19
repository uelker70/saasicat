<template>
    <template v-if="visible">
        <slot />
    </template>
    <template v-else>
        <slot name="fallback" />
    </template>
</template>

<script setup lang="ts">
// FeatureGate — deklarative Show/Hide-Komponente auf Basis Entitlement.
//
// Verwendung:
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
// Mehrere Features → Logical-OR (sobald **eines** im Plan ist, wird der
// Default-Slot gerendert). Identisch zu `@RequireFeature(...)` im Backend.
//
// Voraussetzung: `provideEntitlement(app, ent)` im App-Bootstrap. Ohne
// Provider rendert die Komponente den Default-Slot (Fail-Open im Dev-Mode,
// Konsole-Warning). Apps, die das härter haben wollen, setzen
// `strictMode: true` im Provider — dann wirft `useInjectedEntitlement` statt
// `null` zu liefern. (Strict-Mode kommt später; aktuell Default = lenient.)

import { computed } from 'vue';
import { useInjectedEntitlement } from '../entitlement-provider.js';

interface Props {
    /** Ein FeatureKey oder mehrere als Logical-OR. */
    feature: string | readonly string[];
}

const props = defineProps<Props>();
const ent = useInjectedEntitlement();

const visible = computed<boolean>(() => {
    if (!ent) {
        // Kein Provider — Dev-Fallback: rendern.
        return true;
    }
    const required = Array.isArray(props.feature) ? props.feature : [props.feature];
    return required.some((f) => ent.hasFeature(f));
});
</script>
