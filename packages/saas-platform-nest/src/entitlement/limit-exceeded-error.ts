// LimitExceededError — thrown by the EntitlementService (Slice B, service layer)
// and by consumer limit guards when a creation attempt would exceed the
// effective Quota.
//
// `dimension` is the `quotaKey` from the PlanCatalog (e.g. "users",
// "vehicles", "storageGb"). Consumers can embed the value directly in HTTP 402
// responses and user messages.

const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED';

export class LimitExceededError extends Error {
    readonly code = LIMIT_EXCEEDED;
    constructor(
        public readonly dimension: string,
        public readonly max: number,
        public readonly used: number,
    ) {
        super(`Limit für ${dimension} erreicht: ${used}/${max}.`);
        this.name = 'LimitExceededError';
    }
}

/**
 * Realm-safe type guard (checks `code` instead of `instanceof`). The tsup
 * multi-entry build duplicates this class into every sub-bundle
 * (platform/billing/entitlement), so an `instanceof` between thrower and
 * catcher from different entries is false — same hazard the token registry
 * solves with `Symbol.for` and `isPlatformUserExistsError` solves for types.
 */
export function isLimitExceededError(err: unknown): err is LimitExceededError {
    return err instanceof Error && (err as { code?: string }).code === LIMIT_EXCEEDED;
}
