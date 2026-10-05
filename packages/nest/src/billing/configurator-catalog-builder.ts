import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    ConfiguratorCatalog,
    ConfiguratorMarketingProvider,
    ConfiguratorPlanVersionRow,
    ConfiguratorSourcesLookup,
} from '@saasicat/core';

import { TAX_TREATMENTS_TOKEN } from '../tax/tax.tokens.js';
import type { TaxTreatments } from '../tax/tax-treatments.js';

/**
 * Builds the `ConfiguratorCatalog` (for onboarding step 3) from the
 * live `plan_versions` (SuperAdmin defines plans + prices) plus the
 * app-specific plan-marketing source (`ConfiguratorMarketingProvider`).
 *
 * Deliberately no DI on the marketing provider via token — the builder is
 * a pure-function-like class that consumers call directly (typically in an
 * app adapter that implements `RegistrationConfiguratorLookup.getCatalog()`).
 */
@Injectable()
export class ConfiguratorCatalogBuilder {
    constructor(
        @Optional()
        @Inject(TAX_TREATMENTS_TOKEN)
        private readonly taxes: TaxTreatments | null = null,
    ) {}

    async build(input: {
        sources: ConfiguratorSourcesLookup;
        marketing: ConfiguratorMarketingProvider;
    }): Promise<ConfiguratorCatalog> {
        const { sources, marketing } = input;
        const planRows = await sources.listLivePlans();

        const planMarketingByPlanId = new Map(
            marketing.listPlanMarketing().map((m) => [m.planId, m]),
        );

        return {
            currency: marketing.getCurrency(),
            vatRate: this.vatRateOf(marketing),
            models: planRows
                .filter((row) => row.marketed)
                .map((row) => buildModel(row, planMarketingByPlanId))
                .filter((m): m is NonNullable<typeof m> => m !== null),
        };
    }

    /**
     * The rate shown: the tax adapter's for a subscriber in the issuer's
     * country where config/saas.yaml names one, the provider's otherwise — one
     * source either way, so a provider naming a rate beside an adapter is an
     * error rather than a second answer.
     */
    private vatRateOf(marketing: ConfiguratorMarketingProvider): number {
        const stated = marketing.getVatRate?.();
        if (this.taxes?.adapter) {
            if (stated !== undefined) {
                throw new Error(
                    'ConfiguratorMarketingProvider.getVatRate names a rate beside the tax adapter ' +
                        'config/saas.yaml names. The adapter is the one source of the rate: remove getVatRate.',
                );
            }
            return this.taxes.shown(new Date(), 'monthly').rate;
        }
        if (stated === undefined) {
            throw new Error(
                'ConfiguratorMarketingProvider.getVatRate is required where config/saas.yaml names no tax adapter.',
            );
        }
        return stated;
    }
}

function buildModel(
    row: ConfiguratorPlanVersionRow,
    marketing: Map<string, ReturnType<ConfiguratorMarketingProvider['listPlanMarketing']>[number]>,
): ConfiguratorCatalog['models'][number] | null {
    const m = marketing.get(row.planId);
    if (!m) return null; // App has no marketing entry for this plan → hidden.
    return {
        id: row.planId.toLowerCase(),
        code: m.code,
        name: m.name,
        glyph: m.glyph,
        tagline: m.tagline,
        planId: row.planId,
        monthlyNet: row.monthlyNet,
        yearlyNet: row.yearlyNet,
        tags: m.tags,
        includedFeatureKeys: row.features,
        quotaBase: normalizeQuotas(row.quotas),
        ...(m.popular ? { popular: true } : {}),
    };
}

function normalizeQuotas(quotas: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(quotas)) {
        // The plan catalog stores `-1` as "unlimited" — we map that to a high
        // value so the UI can compute numerically.
        out[k] = v === -1 ? Number.MAX_SAFE_INTEGER : v;
    }
    return out;
}
