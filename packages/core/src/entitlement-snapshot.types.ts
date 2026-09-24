export interface EffectiveLimitsSnapshot {
    plan: string;
    quotas: Record<string, number>;
    features: string[];
    /**
     * The add-ons a contract left out of these entitlements because their
     * cancellation was already declared when it was written. Each is granted by
     * its booking until its effective date, and by this snapshot never.
     *
     * Absent where nothing was left out — and on a snapshot written by an
     * application, or before the platform left anything out, which then counts
     * every add-on it names as its own.
     */
    leftOutBundleVersionIds?: string[];
}
