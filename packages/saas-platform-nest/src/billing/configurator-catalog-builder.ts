import { Injectable } from '@nestjs/common';
import type {
    ConfiguratorCatalog,
    ConfiguratorMarketingProvider,
    ConfiguratorPlanVersionRow,
    ConfiguratorSourcesLookup,
} from '@saasicat/types';

/**
 * Baut den `ConfiguratorCatalog` (fuer Onboarding-Step 3) aus den
 * live `plan_versions` (SuperAdmin definiert Plans + Preise) plus der
 * App-spezifischen Plan-Marketing-Quelle (`ConfiguratorMarketingProvider`).
 *
 * Bewusst kein DI auf den Marketing-Provider via Token — der Builder ist
 * eine reine Pure-Function-aehnliche Klasse, die Konsumenten direkt
 * aufrufen (typischerweise in einem App-Adapter, der
 * `RegistrationConfiguratorLookup.getCatalog()` implementiert).
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
    if (!m) return null; // App hat keinen Marketing-Eintrag fuer diesen Plan → versteckt.
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
        // Plan-Catalog speichert `-1` als "unbegrenzt" — wir mappen das auf
        // einen hohen Wert, damit die UI numerisch rechnen kann.
        out[k] = v === -1 ? Number.MAX_SAFE_INTEGER : v;
    }
    return out;
}
