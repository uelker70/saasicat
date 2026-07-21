import { Injectable } from '@nestjs/common';
import type {
    ConfiguratorCatalog,
    ConfiguratorMarketingProvider,
    ConfiguratorPlanVersionRow,
    ConfiguratorSourcesLookup,
} from '@saasicat/types';

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
            cycleDiscount: marketing.getCycleDiscount(),
            currency: marketing.getCurrency(),
            vatRate: marketing.getVatRate(),
            models: planRows
                .filter((row) => row.marketed)
                .map((row) => buildModel(row, planMarketingByPlanId))
                .filter((m): m is NonNullable<typeof m> => m !== null),
        };
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
