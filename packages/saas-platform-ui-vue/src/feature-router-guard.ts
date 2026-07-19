// Feature-Router-Guard — Vue-Router `beforeEach`, der Routen mit
// `meta.requiresFeature` gegen die Entitlement-Source-of-Truth checkt.
//
// Verwendung (in der App-Router-Setup, alternativ via createSuperAdminApp):
//
// ```ts
// import { useEntitlement, buildFeatureRouterGuard } from '@saasicat/ui-vue';
// const ent = useEntitlement({ endpoint: '/api/billing/entitlement' });
// router.beforeEach(buildFeatureRouterGuard({
//     getEntitlement: () => ent,
//     redirectTo: '/upgrade',
// }));
// ```
//
// Routen-Meta:
//
// ```ts
// { path: '/dms', component: DmsPage, meta: { requiresFeature: 'DMS' } }
// { path: '/x',   component: XPage,   meta: { requiresFeature: ['DMS', 'STORAGE_PRO'] } }
// ```
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P8.

import type { NavigationGuardWithThis, RouteLocationNormalized } from 'vue-router';
import type { UseEntitlementResult } from './use-entitlement.js';

export interface FeatureRouterGuardOptions {
    /**
     * Liefert das aktuelle Entitlement. Bewusst Factory (statt direkter
     * Ref-Übergabe), damit die App das Entitlement lazy laden und neu
     * binden kann — z. B. nach Plan-Wechsel oder Logout/Re-Login.
     */
    getEntitlement: () => UseEntitlementResult | null;
    /**
     * Wohin redirecten, wenn Feature fehlt. Default: kein Redirect, sondern
     * `next(false)` (Route blockt). Apps mit Upgrade-Page setzen
     * `'/upgrade'`.
     */
    redirectTo?: string;
    /**
     * `true` (Default): Entitlement noch nicht geladen → durchlassen,
     * damit der Erste-Render nicht hängt. `false`: blockt bis Entitlement
     * da ist (User sieht weißen Screen, falls Endpoint lahm — nur in
     * Apps mit Pre-Login-Load sinnvoll).
     */
    allowWhileLoading?: boolean;
}

function extractRequired(to: RouteLocationNormalized): string[] {
    const raw = (to.meta as { requiresFeature?: string | string[] } | undefined)?.requiresFeature;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
}

export function buildFeatureRouterGuard(
    options: FeatureRouterGuardOptions,
): NavigationGuardWithThis<undefined> {
    return function featureGuard(to, _from, next) {
        const required = extractRequired(to);
        if (required.length === 0) return next();
        const ent = options.getEntitlement();
        if (!ent) {
            // Kein Provider — durchlassen (das verhindert dass die
            // ganze App stehen bleibt, falls die App den Guard registriert
            // hat, aber das Entitlement noch nicht).
            return next();
        }
        const allowLoading = options.allowWhileLoading !== false;
        if (allowLoading && ent.loading.value && ent.entitlement.value === null) {
            return next();
        }
        const allowed = required.some((f) => ent.hasFeature(f));
        if (allowed) return next();
        if (options.redirectTo) return next(options.redirectTo);
        return next(false);
    };
}
