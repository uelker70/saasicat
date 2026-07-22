// Entitlement provider — app-wide inject key for FeatureGate / router guard.
//
// Consumers call `provideEntitlement(app, ent)` once at app bootstrap,
// where `ent` is the result of `useEntitlement({...})`. Afterwards
// <FeatureGate> components and the router guard can access it without
// reconfiguring the endpoint.
//
// `Symbol.for(...)` so that multi-bundle setups (app bundle + pages bundle)
// resolve to the same identity — analogous to the inject keys in
// create-super-admin-app.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P8.

import { inject, type App, type InjectionKey } from 'vue';
import type { UseEntitlementResult } from './use-entitlement.js';

export const ENTITLEMENT_INJECTION_KEY: InjectionKey<UseEntitlementResult> = Symbol.for(
    '@saasicat/ui-vue/ENTITLEMENT',
);

/**
 * Binds a `useEntitlement(...)` result for the whole app so that
 * `<FeatureGate>` and router guards can inject it.
 */
export function provideEntitlement(app: App, entitlement: UseEntitlementResult): void {
    app.provide(ENTITLEMENT_INJECTION_KEY, entitlement);
}

/**
 * Fetches the bound entitlement result. Returns `null` when the
 * consumer did not call `provideEntitlement(...)` — `<FeatureGate>`
 * then falls back to "everything allowed" (with a dev warning).
 */
export function useInjectedEntitlement(): UseEntitlementResult | null {
    return inject(ENTITLEMENT_INJECTION_KEY, null);
}
