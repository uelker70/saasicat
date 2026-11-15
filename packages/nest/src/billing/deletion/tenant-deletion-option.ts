// What `subscriptionEnds.deletion` takes beside the installation's brake, and
// why a start is refused without it (`SC-PRIV-022`): the application's
// erasers, one per store, its report of what a tenant keeps itself, where each
// deletion is recorded, and where the subscriber it is recorded with is found.
// The sentences are shared by the start rules of `SaaSiCatModule`, by
// `TenantBillingModule` wired by hand and by the service that reads the
// erasers once they are resolved, so all three say the same.

import { TENANT_DELETION_KEY_MAX_LENGTH, isTenantDeletionKey } from '@saasicat/core';

/** What is wrong with the erasers an application lists. */
export type TenantErasersProblem =
    | { readonly kind: 'missing' }
    | { readonly kind: 'not-a-list' }
    | { readonly kind: 'empty' }
    | { readonly kind: 'not-an-eraser'; readonly position: number }
    | { readonly kind: 'name'; readonly position: number }
    | { readonly kind: 'duplicate-name'; readonly position: number };

/** Whether `value` answers `count` and `erase`. */
function countsAndErases(value: object): boolean {
    return (
        'count' in value &&
        typeof value.count === 'function' &&
        'erase' in value &&
        typeof value.erase === 'function'
    );
}

/**
 * What is wrong with `value` as the application's erasers, or null where it
 * is a list of at least one, each with `count` and `erase` and a name that is
 * a stable key no other eraser in the list has.
 */
export function tenantErasersProblem(value: unknown): TenantErasersProblem | null {
    if (value === undefined || value === null) return { kind: 'missing' };
    if (!Array.isArray(value)) return { kind: 'not-a-list' };
    const listed: readonly unknown[] = value;
    if (listed.length === 0) return { kind: 'empty' };
    const names = new Set<string>();
    for (const [position, eraser] of listed.entries()) {
        if (typeof eraser !== 'object' || eraser === null || !countsAndErases(eraser)) {
            return { kind: 'not-an-eraser', position };
        }
        const name: unknown = 'name' in eraser ? eraser.name : undefined;
        if (!isTenantDeletionKey(name)) return { kind: 'name', position };
        if (names.has(name)) return { kind: 'duplicate-name', position };
        names.add(name);
    }
    return null;
}

/**
 * Whether `value` is a list to check before the module is built: a provider
 * spec with a factory is resolved only then, and checked by the service.
 */
export function isListedInPlace(value: unknown): boolean {
    return !(typeof value === 'object' && value !== null && 'useFactory' in value);
}

/** What is wrong, in words; positions count from 0, as the list does. */
function whatIsWrong(problem: TenantErasersProblem): string {
    switch (problem.kind) {
        case 'missing':
            return 'is missing';
        case 'not-a-list':
            return 'is not a list of TenantEraser';
        case 'empty':
            return 'lists no eraser';
        case 'not-an-eraser':
            return `holds something at position ${problem.position} that is no TenantEraser, with \`count\` and \`erase\``;
        case 'name':
            return (
                `names the eraser at position ${problem.position} with something other than a ` +
                `stable key — lower-case letters, digits and dashes, beginning with a letter, ` +
                `at most ${TENANT_DELETION_KEY_MAX_LENGTH} characters —`
            );
        case 'duplicate-name':
            return `names the eraser at position ${problem.position} as an eraser before it is named`;
    }
}

/**
 * Why a start is refused where the ends of subscriptions are kept and the
 * erasers are not a list the platform can delete a tenant through, naming the
 * option the way `option` spells it.
 */
export function erasersRefused(option: string, problem: TenantErasersProblem): string {
    return (
        `${option} ${whatIsWrong(problem)}: wherever the end of a subscription is kept, a ` +
        "tenant's data and files are deleted on its day through the application's erasers, one " +
        'per store and called in the order listed, and the record keeps what each counted under ' +
        'its name (SC-PRIV-022), so list at least one TenantEraser, each named once.'
    );
}

/**
 * Why a start is refused where the ends of subscriptions are kept and nothing
 * reports what a tenant keeps itself.
 */
export function keepReportNotWired(option: string): string {
    return (
        `${option} is missing: wherever the end of a subscription is kept, a tenant is told ` +
        'before its deletion what it has to keep for obligations of its own, and the record ' +
        'keeps it (SC-PRIV-022) — pass a TenantKeepReportPort, which answers no lines for a ' +
        'tenant with nothing to keep.'
    );
}

/**
 * Why `TenantBillingModule` wired by hand is refused where the ends of
 * subscriptions are kept and nothing says where each deletion is recorded.
 */
export function deletionRecordsNotWired(option: string): string {
    return (
        `${option} is missing: wherever the end of a subscription is kept, the deletion of a ` +
        'tenant is recorded with its subscriber, and a deletion that is not recorded cannot be ' +
        'proved (SC-PRIV-023) — pass a TenantDeletionRecordPort, which both shipped persistence ' +
        'adapters provide from the `SubscriberTenantDeletion` models of `@saasicat/spec`.'
    );
}

/**
 * Why `TenantBillingModule` wired by hand is refused where the ends of
 * subscriptions are kept and nothing finds a tenant's subscriber.
 */
export function deletionSubscribersNotWired(option: string): string {
    return (
        `${option} is missing: wherever the end of a subscription is kept, the record of a ` +
        "tenant's deletion is kept with its subscriber (SC-PRIV-023) — pass the " +
        'SubscriberRepository, which both shipped persistence adapters provide.'
    );
}

/**
 * Why `TenantBillingModule` wired by hand is refused where the ends of
 * subscriptions are kept and nothing begins a deletion in one transaction.
 */
export function deletionTransactionsNotWired(option: string): string {
    return (
        `${option} is missing: a tenant's deletion begins by recording it and holding the ` +
        'tenant back in one transaction, so that neither stands without the other (SC-PRIV-018) ' +
        '— pass the TransactionRunner of the database the records are kept in.'
    );
}
