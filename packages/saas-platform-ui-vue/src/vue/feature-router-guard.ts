// Feature router guard — Vue Router `beforeEach` that checks routes with
// `meta.requiresFeature` against the entitlement source of truth.
//
// Usage (in the app router setup, alternatively via createSuperAdminApp):
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
// Route meta:
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
     * Returns the current entitlement. Deliberately a factory (instead of
     * passing a ref directly), so the app can lazy-load the entitlement and
     * re-bind it — e.g. after a plan change or logout/re-login.
     */
    getEntitlement: () => UseEntitlementResult | null;
    /**
     * Where to redirect when a feature is missing. Default: no redirect, but
     * `next(false)` (route blocks). Apps with an upgrade page set
     * `'/upgrade'`.
     */
    redirectTo?: string;
    /**
     * `true` (default): entitlement not yet loaded → let through,
     * so the first render doesn't hang. `false`: blocks until the entitlement
     * is there (user sees a white screen if the endpoint is slow — only
     * sensible in apps with pre-login load).
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
            // No provider — let through (this prevents the whole app
            // from stalling if the app registered the guard but the
            // entitlement isn't there yet).
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
