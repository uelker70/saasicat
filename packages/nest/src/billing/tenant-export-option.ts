// What `subscriptionEnds.export` takes: the application's `TenantDataExportPort`,
// whose file the platform serves from `GET billing/export`, or the declaration
// that the application delivers the export itself (`SC-PRIV-020`). One of the
// two is required wherever the ends of subscriptions are kept, and a
// declaration that names anybody else is refused: an object with a
// `deliveredBy` member is never a port, and wired as one it would fail every
// download.

import type { TenantExportDeliveredByTheApplication } from '@saasicat/core';

/** Whether `declared`, the value of `subscriptionEnds.export`, says the application delivers the export itself. */
export function deliversItsOwnExport(
    declared: unknown,
): declared is TenantExportDeliveredByTheApplication {
    return (
        typeof declared === 'object' &&
        declared !== null &&
        'deliveredBy' in declared &&
        declared.deliveredBy === 'application'
    );
}

/**
 * Why a start is refused where the ends of subscriptions are kept and the
 * application wires no export, naming the option the way `option` spells it.
 */
export function exportNotWired(option: string): string {
    return (
        `${option} is missing: wherever the end of a subscription is kept, the application ` +
        "hands over the tenant's full export through a TenantDataExportPort, or declares " +
        "`{ deliveredBy: 'application' }` and delivers it itself, because the read-only " +
        'period before the deletion day exists for the tenant to take it (SC-PRIV-020).'
    );
}

/**
 * Whether `declared`, the value of `subscriptionEnds.export`, is a declaration
 * of who delivers the export that names anybody but the application — a
 * misspelling, or a value the types do not allow.
 */
export function declaresAnotherDeliverer(declared: unknown): declared is { deliveredBy: unknown } {
    return (
        typeof declared === 'object' &&
        declared !== null &&
        'deliveredBy' in declared &&
        declared.deliveredBy !== 'application'
    );
}

/**
 * Why a start is refused where `subscriptionEnds.export` declares a deliverer
 * other than the application, naming the option the way `option` spells it and
 * the value it was given.
 */
export function exportDeliveredByNobody(
    option: string,
    declared: { deliveredBy: unknown },
): string {
    return (
        `${option} declares \`deliveredBy: ${JSON.stringify(declared.deliveredBy)}\`, which ` +
        "nobody delivers the export as: an application that delivers the tenant's full " +
        "export itself declares `{ deliveredBy: 'application' }`, and one that hands it over " +
        'passes a TenantDataExportPort instead (SC-PRIV-020).'
    );
}
