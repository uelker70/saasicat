// useTenantBillingCatalog — Vue-Composable, der die Public-Catalog-
// Endpoints aus `@saasicat/nest/billing/PublicCatalogModule`
// lädt: GET /billing/plans, /billing/feature-registry, /billing/bundles.
//
// Output-Shapes sind Frontend-Mirrors der `PublicCatalogController`-Antworten.
// Werden hier explizit dupliziert (kein Import aus saas-platform-nest), damit
// das Frontend-Bundle nicht den Nest-Server-Code mit zieht.

import { ref, type Ref } from 'vue';
import type { FeatureUiRegistry } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface CatalogPlan {
    id: string;
    name: string;
    tagline: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    popular: boolean;
    quotas: Record<string, number>;
    features: string[];
}

/**
 * Buchbares Catalog-Bundle (Wire-Form von `PublicBundleEntry` aus
 * `GET /billing/bundles`) — eigenständige Catalog-Bundles
 * (`bundle_versions`) mit eigenem Kauf-Flow `/billing/subscription-bundles`.
 * Preise kommen als Dezimal-String vom Wire und werden hier zu `number`.
 */
export interface CatalogBundle {
    bundleVersionId: string;
    bundleKey: string;
    label: string;
    description: string | null;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: number | null;
    yearlyNet: number | null;
    /**
     * Ungedeckte Feature-Abhängigkeiten (#35): Union der `requires` der
     * enthaltenen Features minus der im Bundle selbst enthaltenen. Die UI
     * graut das Bundle aus, wenn diese Keys weder im Plan noch in den
     * aktiven Bundles liegen. Leer ohne requires-Daten (graceful).
     */
    requiresFeatures: string[];
    /** Marketing-Preis-Label (z. B. „ab 19 €/Monat") — null = Auto-Format. */
    priceTag: string | null;
}

interface PublicBundleWire {
    bundleVersionId: string;
    bundleKey: string;
    label: string;
    description: string | null;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: string | null;
    yearlyNet: string | null;
    requiresFeatures?: string[];
    marketing?: { priceTag?: string | null };
}

export interface UseTenantBillingCatalogOptions {
    /**
     * URL-Prefix vor `/plans`, `/feature-registry`, `/bundles`.
     * Default `'/billing'`. **Konvention**: `apiPrefix` ist der Sub-Pfad
     * UNTER der App-API-Base-URL, die der HTTP-Adapter selbst hält.
     * Beispiel: HTTP-Adapter baseURL `/api` + apiPrefix `/billing` →
     * `/api/billing/...`. NICHT `'/api/billing'` setzen, wenn der
     * HTTP-Adapter bereits `/api` als baseURL hat (→ `/api/api/...`-404).
     */
    apiPrefix?: string;
    http?: HttpClient;
    /**
     * Default `true`. Auf `false` setzen, wenn der Konsument selbst
     * `load()` triggern möchte (z. B. nach Login).
     */
    autoLoad?: boolean;
}

export interface UseTenantBillingCatalogResult {
    plans: Ref<CatalogPlan[] | null>;
    featureRegistry: Ref<FeatureUiRegistry | null>;
    /**
     * Buchbare Catalog-Bundles (`/billing/bundles`). `null` solange nicht
     * geladen; `[]` wenn der Endpoint fehlt/leer ist (non-fatal).
     */
    bundles: Ref<CatalogBundle[] | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Lädt Plans/Feature-Registry parallel + Bundles (non-fatal). */
    load: () => Promise<void>;
}

export function useTenantBillingCatalog(
    options: UseTenantBillingCatalogOptions = {},
): UseTenantBillingCatalogResult {
    const apiPrefix = (options.apiPrefix ?? '/billing').replace(/\/+$/, '');
    const http = options.http ?? defaultHttpClient();

    const plans = ref<CatalogPlan[] | null>(null);
    const featureRegistry = ref<FeatureUiRegistry | null>(null);
    const bundles = ref<CatalogBundle[] | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function fetchJson<T>(path: string): Promise<T> {
        const res = await http(`${apiPrefix}${path}`, { method: 'GET' });
        if (res.status !== 200) {
            throw new Error(`${apiPrefix}${path} → HTTP ${res.status}`);
        }
        return (await res.json()) as T;
    }

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            const [plansResult, registryResult] = await Promise.all([
                fetchJson<CatalogPlan[]>('/plans'),
                fetchJson<FeatureUiRegistry>('/feature-registry'),
            ]);
            plans.value = plansResult;
            featureRegistry.value = registryResult;
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            plans.value = null;
            featureRegistry.value = null;
        } finally {
            loading.value = false;
        }
        // Bundle-Katalog non-fatal nachladen — ein fehlender `/bundles`-Endpoint
        // (Konsument ohne PublicCatalog-Bundle-Wiring) darf die Plan-Seite nicht
        // in den Fehlerzustand kippen.
        try {
            const raw = await fetchJson<PublicBundleWire[]>('/bundles');
            bundles.value = (raw ?? []).map((b) => ({
                bundleVersionId: b.bundleVersionId,
                bundleKey: b.bundleKey,
                label: b.label,
                description: b.description,
                features: b.features ?? [],
                quotas: b.quotas ?? {},
                monthlyNet: b.monthlyNet !== null ? parseFloat(b.monthlyNet) : null,
                yearlyNet: b.yearlyNet !== null ? parseFloat(b.yearlyNet) : null,
                requiresFeatures: b.requiresFeatures ?? [],
                priceTag: b.marketing?.priceTag ?? null,
            }));
        } catch {
            bundles.value = [];
        }
    }

    if (options.autoLoad !== false) {
        Promise.resolve().then(() => void load());
    }

    return { plans, featureRegistry, bundles, loading, error, load };
}
