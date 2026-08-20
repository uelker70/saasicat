// The resource layer: every admin endpoint defined once, framework-free.
//
// The roster is complete for what the platform serves. Three names from the
// original plan are deliberately absent, and each is absent for a reason a
// grep can confirm rather than a decision taken here:
//
//   - `pilots` — no platform controller serves `/admin/pilots`, and none is
//     planned. The endpoints exist in one consumer's own backend
//     (`vereinsfux/apps/api`), which is why `PilotsPage` takes them as props.
//     A platform default would be an invented API that happens to match one
//     app and breaks the next.
//   - `email` — the same, for `/admin/platform-email/*`.
//   - `dashboard` — the platform does serve `/admin/stats/dashboard`, but
//     `DashboardPage` never asks for it: every KPI card fetches the `endpoint`
//     its manifest entry declares. A descriptor with a hardcoded path would
//     contradict `KpiCardDef.endpoint`, and nothing would call it.
//
// What is here instead is one descriptor per family the platform owns, plus
// the split the sources forced: the plan's single `promos` turned out to be
// two unrelated resources — `promoCodes` (`/admin/promo-codes`, a string a
// customer types) and `promotions` (`/admin/catalog/promotions`, a price rule
// on a catalogue entry). They share four operation names and nothing else.
//
// Every descriptor is measured against the implementation it mirrors:
// `tests/resources-match-the-composables.test.js` drives both sides with the
// same arguments and compares what reaches the client, in either direction. A
// descriptor with no such partner is not added — there would be nothing
// keeping it honest.

export * from './define-resource.js';
export * from './resource-request.js';
export * from './list-resource.js';
export * from './plans.resource.js';
export * from './bundles.resource.js';
export * from './catalog.resource.js';
export * from './discovery.resource.js';
export * from './marketing.resource.js';
export * from './promo-codes.resource.js';
export * from './promotions.resource.js';
export * from './tenants.resource.js';
export * from './users.resource.js';
export * from './subscriptions.resource.js';
export * from './audit.resource.js';

import { auditResource } from './audit.resource.js';
import { bundleVersionsResource, bundlesResource } from './bundles.resource.js';
import { catalogResource } from './catalog.resource.js';
import { discoveryResource } from './discovery.resource.js';
import { marketingResource } from './marketing.resource.js';
import { planVersionsResource, plansResource } from './plans.resource.js';
import { promoCodesResource } from './promo-codes.resource.js';
import { promotionsResource } from './promotions.resource.js';
import { subscriptionsResource } from './subscriptions.resource.js';
import { tenantsResource } from './tenants.resource.js';
import { usersResource } from './users.resource.js';

/**
 * Every resource the shell offers by default.
 *
 * The registry binds these; an app overrides by key. A page whose data is
 * app-owned — pilots, platform e-mail — keeps its props, because there is no
 * platform default to override.
 */
export const platformResources = {
    plans: plansResource,
    planVersions: planVersionsResource,
    bundles: bundlesResource,
    bundleVersions: bundleVersionsResource,
    catalog: catalogResource,
    discovery: discoveryResource,
    marketing: marketingResource,
    promoCodes: promoCodesResource,
    promotions: promotionsResource,
    tenants: tenantsResource,
    users: usersResource,
    subscriptions: subscriptionsResource,
    audit: auditResource,
};

export type PlatformResources = typeof platformResources;
