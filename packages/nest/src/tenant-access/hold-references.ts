import type { TenantAccessHold } from '@saasicat/core';

/** What the reasons of `kind` among `holds` are about: the invoice, or the subscription that ended. */
export function referencesOf(
    holds: readonly TenantAccessHold[],
    kind: 'overdue' | 'ended',
): string[] {
    return holds.flatMap((hold) =>
        hold.kind === kind && hold.reference !== null ? [hold.reference] : [],
    );
}
