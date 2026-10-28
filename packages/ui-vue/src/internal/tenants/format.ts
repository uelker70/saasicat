// Formatting helpers for the tenants page.
//
// Shared between TenantsPage.vue and subcomponents (Avatar, Pill).
// Apps with their own plan accents pass them through via the `planAccents` prop.
//
// The default map used to live here as five hex literals, and it disagreed with
// the two in `PlanList`/`PlanMatrix`: `STANDARD` was the brand blue on this page
// and a plain blue on the plans page, `ENTERPRISE` near-black here and teal
// there. Same plan, three colours, depending on which screen you were looking
// at. It now comes from the shared ramp, so the answer is one.

import { IDENTITY_NEUTRAL, identityAccentFor } from '../../client/identity-accents.js';

export function tenantInitials(name: string | null | undefined): string {
    if (!name) return '?';
    return name
        .replace(/[^A-Za-zÄÖÜäöü]/g, '')
        .slice(0, 2)
        .toUpperCase();
}

export function planAccent(
    planId: string | null | undefined,
    accents: Record<string, string> = {},
): string {
    if (!planId) return IDENTITY_NEUTRAL;
    return identityAccentFor(planId, accents);
}
