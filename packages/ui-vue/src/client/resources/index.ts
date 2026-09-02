// The resource layer: every admin endpoint defined once, framework-free.
//
// The roster covers what the platform serves and, since the pages stopped
// taking their data as props, four families it does not:
//
//   - `pilots` and `platformEmail`/`emailHistory` — no platform controller
//     serves `/admin/pilots` or `/admin/platform-email/*`, and none is planned.
//     The endpoints live in the consumers' own backends. They are descriptors
//     anyway because every consumer already calls the same paths, so recording
//     them removes the callbacks the pages used to need without inventing an
//     API: an app whose backend differs overrides the descriptor, which is one
//     line where a prop was a wiring exercise per page.
//   - `dashboard` — the platform serves `/admin/stats/dashboard`, but no card
//     asks for it: each KPI card carries the `endpoint` its manifest entry
//     declares, which is how an app puts its own numbers on the dashboard. So
//     the descriptor takes the card and reads the endpoint off it rather than
//     composing a path, and what it returns is a reading rather than a
//     rendering — see `dashboard.resource.ts`.
//
// The rest is one descriptor per family the platform owns, plus the split the
// sources forced: the plan's single `promos` turned out to be two unrelated
// resources — `promoCodes` (`/admin/promo-codes`, a string a customer types)
// and `promotions` (`/admin/catalog/promotions`, a price rule on a catalogue
// entry). They share four operation names and nothing else.
//
// Every descriptor is measured. Where a second implementation of the same
// contract exists, `tests/resources-match-the-composables.test.js` drives both
// with the same arguments and compares what reaches the client, in either
// direction. Where none does — the four families above and a handful of
// individual operations — `tests/app-served-resources.test.js` pins the request
// instead. Both files derive their expectation from the roster, so an operation
// added here cannot ship unmeasured.

export * from './define-resource.js';
export * from './resource-request.js';
export * from './list-resource.js';
export * from './plans.resource.js';
export * from './bundles.resource.js';
export * from './catalog.resource.js';
export * from './dashboard.resource.js';
export * from './discovery.resource.js';
export * from './marketing.resource.js';
export * from './promo-codes.resource.js';
export * from './promotions.resource.js';
export * from './tenants.resource.js';
export * from './users.resource.js';
export * from './subscriptions.resource.js';
export * from './audit.resource.js';
export * from './pilots.resource.js';
export * from './platform-email.resource.js';
export * from './settings.resource.js';

import { auditResource } from './audit.resource.js';
import { pilotsResource } from './pilots.resource.js';
import { platformEmailResource, emailHistoryResource } from './platform-email.resource.js';
import { bundleVersionsResource, bundlesResource } from './bundles.resource.js';
import { catalogResource } from './catalog.resource.js';
import { dashboardResource } from './dashboard.resource.js';
import { discoveryResource } from './discovery.resource.js';
import { marketingResource } from './marketing.resource.js';
import { planVersionsResource, plansResource } from './plans.resource.js';
import { promoCodesResource } from './promo-codes.resource.js';
import { promotionsResource } from './promotions.resource.js';
import { settingsResource } from './settings.resource.js';
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
    dashboard: dashboardResource,
    discovery: discoveryResource,
    marketing: marketingResource,
    promoCodes: promoCodesResource,
    promotions: promotionsResource,
    tenants: tenantsResource,
    users: usersResource,
    subscriptions: subscriptionsResource,
    audit: auditResource,
    settings: settingsResource,
    // ── App-served, platform-shaped ──────────────────────────────────────────
    //
    // The platform ships pages for these three and serves no route for any of
    // them: pilots, SMTP providers and the send log belong to the consuming
    // app's backend. They are in the roster anyway, because the paths are the
    // ones the consumers already call — recording that convention is what lets
    // their pages drop nineteen callbacks between them.
    //
    // An app that mounts one of those pages implements the routes, or overrides
    // the operations. An app that does not mount them pays nothing: a
    // descriptor is a table of functions until something calls one.
    pilots: pilotsResource,
    platformEmail: platformEmailResource,
    emailHistory: emailHistoryResource,
};

export type PlatformResources = typeof platformResources;
