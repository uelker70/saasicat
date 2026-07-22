// Aggregated platform catalog. `SaMessages` derives from the German reference
// structure of every namespace; the English variants are shape-checked in the
// namespace files via `defineMessages`.

import { mergeMessages, type PartialMessages } from './define.js';
import type { SaLocale } from './locale.js';
import { auditMessages } from './messages/audit.js';
import { bundlesMessages } from './messages/bundles.js';
import { businessTypesMessages } from './messages/business-types.js';
import { commonMessages } from './messages/common.js';
import { dashboardMessages } from './messages/dashboard.js';
import { discoveryMessages } from './messages/discovery.js';
import { emailMessages } from './messages/email.js';
import { marketingMessages } from './messages/marketing.js';
import { navMessages } from './messages/nav.js';
import { pilotsMessages } from './messages/pilots.js';
import { planDetailMessages } from './messages/plan-detail.js';
import { planEditorMessages } from './messages/plan-editor.js';
import { planVersionsMessages } from './messages/plan-versions.js';
import { plansMessages } from './messages/plans.js';
import { promosMessages } from './messages/promos.js';
import { shellMessages } from './messages/shell.js';
import { tenantsMessages } from './messages/tenants.js';
import { usersMessages } from './messages/users.js';

/** Complete platform catalog for one locale, keyed by namespace. */
export type SaMessages = {
    readonly common: (typeof commonMessages)['de'];
    readonly nav: (typeof navMessages)['de'];
    readonly shell: (typeof shellMessages)['de'];
    readonly dashboard: (typeof dashboardMessages)['de'];
    readonly tenants: (typeof tenantsMessages)['de'];
    readonly users: (typeof usersMessages)['de'];
    readonly audit: (typeof auditMessages)['de'];
    readonly plans: (typeof plansMessages)['de'];
    readonly planDetail: (typeof planDetailMessages)['de'];
    readonly planEditor: (typeof planEditorMessages)['de'];
    readonly planVersions: (typeof planVersionsMessages)['de'];
    readonly bundles: (typeof bundlesMessages)['de'];
    readonly discovery: (typeof discoveryMessages)['de'];
    readonly marketing: (typeof marketingMessages)['de'];
    readonly businessTypes: (typeof businessTypesMessages)['de'];
    readonly promos: (typeof promosMessages)['de'];
    readonly pilots: (typeof pilotsMessages)['de'];
    readonly email: (typeof emailMessages)['de'];
};

/** Shape of app-side string overrides (deep partial of the catalog). */
export type SaMessagesOverrides = PartialMessages<SaMessages>;

function catalogFor(locale: SaLocale): SaMessages {
    return {
        common: commonMessages[locale],
        nav: navMessages[locale],
        shell: shellMessages[locale],
        dashboard: dashboardMessages[locale],
        tenants: tenantsMessages[locale],
        users: usersMessages[locale],
        audit: auditMessages[locale],
        plans: plansMessages[locale],
        planDetail: planDetailMessages[locale],
        planEditor: planEditorMessages[locale],
        planVersions: planVersionsMessages[locale],
        bundles: bundlesMessages[locale],
        discovery: discoveryMessages[locale],
        marketing: marketingMessages[locale],
        businessTypes: businessTypesMessages[locale],
        promos: promosMessages[locale],
        pilots: pilotsMessages[locale],
        email: emailMessages[locale],
    };
}

/** Complete, immutable message catalogs per locale. */
export const SA_MESSAGES: Record<SaLocale, SaMessages> = {
    de: catalogFor('de'),
    en: catalogFor('en'),
};

/**
 * Returns the platform catalog for `locale`, optionally overlaid with
 * app-side overrides.
 */
export function resolveMessages(locale: SaLocale, overrides?: SaMessagesOverrides): SaMessages {
    if (!overrides) return SA_MESSAGES[locale];
    return mergeMessages(SA_MESSAGES[locale], overrides);
}
