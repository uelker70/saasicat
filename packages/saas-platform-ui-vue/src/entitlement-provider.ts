// Entitlement-Provider — App-weiter Inject-Key für FeatureGate / Router-Guard.
//
// Konsumenten rufen einmal beim App-Bootstrap `provideEntitlement(app, ent)`
// auf, wo `ent` das Result von `useEntitlement({...})` ist. Anschließend
// können <FeatureGate>-Komponenten und der Router-Guard ohne erneute
// Endpoint-Konfiguration darauf zugreifen.
//
// `Symbol.for(...)` damit Multi-Bundle-Setups (App-Bundle + Pages-Bundle)
// auf dieselbe Identity auflösen — analog zu den Inject-Keys in
// create-super-admin-app.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P8.

import { inject, type App, type InjectionKey } from 'vue';
import type { UseEntitlementResult } from './use-entitlement.js';

export const ENTITLEMENT_INJECTION_KEY: InjectionKey<UseEntitlementResult> = Symbol.for(
    '@saasicat/ui-vue/ENTITLEMENT',
);

/**
 * Bindet ein `useEntitlement(...)`-Result für die ganze App, sodass
 * `<FeatureGate>` und Router-Guards es injecten können.
 */
export function provideEntitlement(app: App, entitlement: UseEntitlementResult): void {
    app.provide(ENTITLEMENT_INJECTION_KEY, entitlement);
}

/**
 * Holt das gebundene Entitlement-Result. Liefert `null`, wenn der
 * Konsument `provideEntitlement(...)` nicht aufgerufen hat — `<FeatureGate>`
 * fällt dann auf „alles erlaubt" zurück (mit Dev-Warning).
 */
export function useInjectedEntitlement(): UseEntitlementResult | null {
    return inject(ENTITLEMENT_INJECTION_KEY, null);
}
