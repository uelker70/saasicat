// LimitExceededError — thrown by the EntitlementService (Slice B, service layer)
// and by consumer limit guards when a creation attempt would exceed the
// effective Quota.
//
// `dimension` is the `quotaKey` from the PlanCatalog (e.g. "users",
// "vehicles", "storageGb"). Consumers can embed the value directly in HTTP 402
// responses and user messages.

export class LimitExceededError extends Error {
    constructor(
        public readonly dimension: string,
        public readonly max: number,
        public readonly used: number,
    ) {
        super(`Limit für ${dimension} erreicht: ${used}/${max}.`);
        this.name = 'LimitExceededError';
    }
}
