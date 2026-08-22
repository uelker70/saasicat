import type { QuotaProvider, UsageSnapshotPort } from '@saasicat/types';

/**
 * Reuses the registered quota counters for the tenant usage response. A quota
 * is counted once and serves both runtime enforcement and the billing UI.
 */
export class QuotaProvidersUsageSnapshot implements UsageSnapshotPort {
    constructor(private readonly providers: ReadonlyArray<QuotaProvider>) {}

    async snapshot(tenantId: string): Promise<Record<string, number>> {
        const entries = await Promise.all(
            this.providers.map(
                async (provider) => [provider.key, await provider.count(tenantId)] as const,
            ),
        );
        return Object.fromEntries(entries);
    }
}
