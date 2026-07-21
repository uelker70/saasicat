// useTenantBillingCatalog — Vue composable that loads the public catalog
// endpoints from `@saasicat/nest/billing/PublicCatalogModule`:
// GET /billing/plans, /billing/feature-registry, /billing/bundles.
//
// Output shapes are frontend mirrors of the `PublicCatalogController` responses.
// They are explicitly duplicated here (no import from saas-platform-nest) so
// that the frontend bundle does not pull in the Nest server code.

import { ref, type Ref } from 'vue';
import type { FeatureUiRegistry } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';
import { trimTrailingSlashes } from './http-json.js';

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
 * Bookable catalog bundle (wire form of `PublicBundleEntry` from
 * `GET /billing/bundles`) — standalone catalog bundles
 * (`bundle_versions`) with their own purchase flow `/billing/subscription-bundles`.
 * Prices arrive as a decimal string on the wire and become `number` here.
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
     * Uncovered feature dependencies (#35): union of the `requires` of the
     * contained features minus those contained in the bundle itself. The UI
     * grays out the bundle if these keys are neither in the plan nor in the
     * active bundles. Empty without requires data (graceful).
     */
    requiresFeatures: string[];
    /** Marketing price label (e.g. "from 19 €/month") — null = auto-format. */
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
     * URL prefix before `/plans`, `/feature-registry`, `/bundles`.
     * Default `'/billing'`. **Convention**: `apiPrefix` is the sub-path
     * UNDER the app API base URL that the HTTP adapter itself holds.
     * Example: HTTP adapter baseURL `/api` + apiPrefix `/billing` →
     * `/api/billing/...`. Do NOT set `'/api/billing'` if the HTTP adapter
     * already has `/api` as baseURL (→ `/api/api/...` 404).
     */
    apiPrefix?: string;
    http?: HttpClient;
    /**
     * Default `true`. Set to `false` if the consumer wants to trigger
     * `load()` itself (e.g. after login).
     */
    autoLoad?: boolean;
}

export interface UseTenantBillingCatalogResult {
    plans: Ref<CatalogPlan[] | null>;
    featureRegistry: Ref<FeatureUiRegistry | null>;
    /**
     * Bookable catalog bundles (`/billing/bundles`). `null` while not yet
     * loaded; `[]` if the endpoint is missing/empty (non-fatal).
     */
    bundles: Ref<CatalogBundle[] | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Loads plans/feature-registry in parallel + bundles (non-fatal). */
    load: () => Promise<void>;
}

export function useTenantBillingCatalog(
    options: UseTenantBillingCatalogOptions = {},
): UseTenantBillingCatalogResult {
    const apiPrefix = trimTrailingSlashes(options.apiPrefix ?? '/billing');
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
        // Load the bundle catalog non-fatally afterwards — a missing `/bundles`
        // endpoint (consumer without PublicCatalog bundle wiring) must not tip
        // the plan page into an error state.
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
