// usePlanEditor — plan-editor discovery + validation for the SuperAdmin UI.
//
// Reads the full feature catalog including the `plannedOnly` marker from the
// loaded manifest (`planCatalogSnapshot.features`) and provides:
//
//   1. `availableFeatures` — all features with reactive markers for the UI:
//      `isPlannedOnly` (rendered in the UI as a "planned" chip), `isSelected`
//      (in the current draft), `isInherited` (in the base plan, cannot be
//      removed if `nonRegressive: true`).
//
//   2. `featuresByTier` — grouping by the `tier` convention (CORE,
//      ADVANCED, PRO, BUSINESS, ENTERPRISE_ONLY) for the
//      drawer rendering. Sorting as in the catalog.
//
//   3. `toggleFeature(key)` — toggles in the draft, but blocks `plannedOnly`
//      features and (optionally) base-plan features on nonRegressive drafts.
//
//   4. `validateDraft()` — before the save: throws if the draft contains a
//      plannedOnly feature (frontend mirror of the backend validation
//      `assertNoPlannedOnlyFeatures` — prevents the UI from sending malformed
//      POST bodies instead of showing the backend 400).
//
// What the platform does NOT do: the HTTP save itself. The consumer sends the
// draft to `PATCH /api/v1/admin/plan-versions/:id` with the endpoint adapter
// of its choice. Discovery + filter + validation lives centrally, persistence
// project-specific.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest, FeatureDef, FeatureKey } from '@saasicat/types';

export class PlannedOnlyFeatureError extends Error {
    constructor(public readonly violations: FeatureKey[]) {
        super(
            `The following features are marked as plannedOnly in the catalog and ` +
                `must not appear in a plan version: ${violations.sort().join(', ')}.`,
        );
        this.name = 'PlannedOnlyFeatureError';
    }
}

export interface FeatureRowMarkers {
    /** Catalog definition (label, icon, tier, marker). */
    def: FeatureDef;
    /** Currently selected in the draft. */
    isSelected: boolean;
    /** Catalog marker `plannedOnly: true` — the UI shows it as roadmap, not bookable. */
    isPlannedOnly: boolean;
    /** In the base plan (inherited) — not removable on nonRegressive drafts. */
    isInherited: boolean;
    /** Computed: is the user allowed to toggle the feature? */
    canToggle: boolean;
}

export interface UsePlanEditorOptions {
    /** Initial selection — typically `draft.features` from PATCH preparation. */
    initialFeatures?: FeatureKey[];
    /** Features the base plan already contained; not removable under nonRegressive. */
    baseFeatures?: FeatureKey[];
    /** If `true`: base features are locked (default `true`, platform convention). */
    nonRegressive?: boolean;
}

export interface UsePlanEditorResult {
    /** Feature keys currently selected in the draft (Set for O(1) lookup). */
    selectedFeatures: Ref<Set<FeatureKey>>;
    /** Ordered list of all catalog features with UI markers. */
    availableFeatures: ComputedRef<FeatureRowMarkers[]>;
    /** Tier grouping for drawer sections (CORE, ADVANCED, PRO, …). */
    featuresByTier: ComputedRef<Array<{ tier: string; rows: FeatureRowMarkers[] }>>;
    /** Toggle without throwing: `plannedOnly` and locked features are ignored. */
    toggleFeature: (key: FeatureKey) => void;
    /** Pre-save validation. Throws `PlannedOnlyFeatureError` if disallowed keys are present. */
    validateDraft: () => void;
    /** Snapshot of the current selection for the PATCH body. */
    snapshot: () => FeatureKey[];
}

const TIER_ORDER = ['CORE', 'ADVANCED', 'PRO', 'BUSINESS', 'ENTERPRISE_ONLY'];

function tierWeight(tier: string | undefined): number {
    if (!tier) return TIER_ORDER.length; // ungrouped goes to the end
    const i = TIER_ORDER.indexOf(tier);
    return i === -1 ? TIER_ORDER.length : i;
}

/**
 * Plan-editor discovery + validation. The manifest provides the source of
 * truth (catalog snapshot including the `plannedOnly` marker). The consumer
 * builds the Vue component and uses this composable for state + filter.
 */
export function usePlanEditor(
    manifest: AdminManifest,
    options: UsePlanEditorOptions = {},
): UsePlanEditorResult {
    const baseSet = new Set(options.baseFeatures ?? []);
    const nonRegressive = options.nonRegressive ?? true;

    const selectedFeatures = ref<Set<FeatureKey>>(new Set(options.initialFeatures ?? []));

    const catalogFeatures: FeatureDef[] = manifest.planCatalogSnapshot.features ?? [];
    const plannedOnlySet = new Set(catalogFeatures.filter((f) => f.plannedOnly).map((f) => f.key));

    const availableFeatures = computed<FeatureRowMarkers[]>(() => {
        return catalogFeatures.map<FeatureRowMarkers>((def) => {
            const isSelected = selectedFeatures.value.has(def.key);
            const isPlannedOnly = !!def.plannedOnly;
            const isInherited = baseSet.has(def.key);
            const canToggle = !isPlannedOnly && (!nonRegressive || !isInherited || !isSelected);
            return { def, isSelected, isPlannedOnly, isInherited, canToggle };
        });
    });

    const featuresByTier = computed(() => {
        const groups = new Map<string, FeatureRowMarkers[]>();
        for (const row of availableFeatures.value) {
            const tier = row.def.tier ?? 'OTHER';
            const list = groups.get(tier) ?? [];
            list.push(row);
            groups.set(tier, list);
        }
        return [...groups.entries()]
            .sort((a, b) => {
                const wa = tierWeight(a[0]);
                const wb = tierWeight(b[0]);
                return wa !== wb ? wa - wb : a[0].localeCompare(b[0]);
            })
            .map(([tier, rows]) => ({ tier, rows }));
    });

    function toggleFeature(key: FeatureKey): void {
        if (plannedOnlySet.has(key)) return; // roadmap feature, not bookable
        const next = new Set(selectedFeatures.value);
        if (next.has(key)) {
            // On nonRegressive drafts an inherited feature must not be removed.
            if (nonRegressive && baseSet.has(key)) return;
            next.delete(key);
        } else {
            next.add(key);
        }
        selectedFeatures.value = next;
    }

    function validateDraft(): void {
        const violations = [...selectedFeatures.value].filter((k) => plannedOnlySet.has(k));
        if (violations.length > 0) {
            throw new PlannedOnlyFeatureError(violations);
        }
    }

    function snapshot(): FeatureKey[] {
        return [...selectedFeatures.value].sort();
    }

    return {
        selectedFeatures,
        availableFeatures,
        featuresByTier,
        toggleFeature,
        validateDraft,
        snapshot,
    };
}
