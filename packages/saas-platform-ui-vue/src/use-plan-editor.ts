// usePlanEditor — Plan-Editor-Discovery + Validation für die SuperAdmin-UI.
//
// Liest aus dem geladenen Manifest (`planCatalogSnapshot.features`) den
// vollständigen Feature-Katalog inklusive `plannedOnly`-Marker und liefert:
//
//   1. `availableFeatures` — alle Features mit reaktiven Markern für UI:
//      `isPlannedOnly` (UI gerendert als „geplant"-Chip), `isSelected`
//      (im aktuellen Draft), `isInherited` (im Base-Plan, kann nicht
//      entfernt werden, falls `nonRegressive: true`).
//
//   2. `featuresByTier` — Gruppierung nach `tier`-Konvention (CORE,
//      ADVANCED, PRO, BUSINESS, ENTERPRISE_ONLY) für die
//      Drawer-Darstellung. Sortierung wie im Catalog.
//
//   3. `toggleFeature(key)` — schaltet im Draft, blockt aber `plannedOnly`-
//      Features und (optional) Base-Plan-Features bei nonRegressive-Drafts.
//
//   4. `validateDraft()` — vor dem Save: wirft, wenn das Draft ein
//      plannedOnly-Feature enthält (Frontend-Mirror der Backend-Validation
//      `assertNoPlannedOnlyFeatures` — verhindert dass das UI fehlerhafte
//      POST-Bodies absendet, statt die Backend-400 zu zeigen).
//
// Was die Plattform NICHT macht: HTTP-Save selbst. Konsument schickt den
// Draft an `PATCH /api/v1/admin/plan-versions/:id` mit dem Endpoint-Adapter
// seiner Wahl. Discovery + Filter + Validation lebt zentral, Persistenz
// projekt-spezifisch.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest, FeatureDef, FeatureKey } from '@saasicat/types';

export class PlannedOnlyFeatureError extends Error {
    constructor(public readonly violations: FeatureKey[]) {
        super(
            `Folgende Features sind im Catalog als plannedOnly markiert und ` +
                `dürfen nicht in einer Plan-Version stehen: ${violations.sort().join(', ')}.`,
        );
        this.name = 'PlannedOnlyFeatureError';
    }
}

export interface FeatureRowMarkers {
    /** Catalog-Definition (Label, Icon, Tier, Marker). */
    def: FeatureDef;
    /** Aktuell im Draft selektiert. */
    isSelected: boolean;
    /** Catalog-Marker `plannedOnly: true` — UI zeigt als Roadmap, nicht buchbar. */
    isPlannedOnly: boolean;
    /** Im Base-Plan (Inherited) — bei nonRegressive-Drafts nicht entfernbar. */
    isInherited: boolean;
    /** Computed: darf der User das Feature toggeln? */
    canToggle: boolean;
}

export interface UsePlanEditorOptions {
    /** Initial-Selection — typischerweise `draft.features` aus PATCH-Vorbereitung. */
    initialFeatures?: FeatureKey[];
    /** Features, die der Base-Plan schon enthielt; bei nonRegressive nicht entfernbar. */
    baseFeatures?: FeatureKey[];
    /** Wenn `true`: Base-Features sind gelocked (Default `true`, Plattform-Konvention). */
    nonRegressive?: boolean;
}

export interface UsePlanEditorResult {
    /** Aktuell im Draft selektierte Feature-Keys (Set für O(1) lookup). */
    selectedFeatures: Ref<Set<FeatureKey>>;
    /** Geordnete Liste aller Catalog-Features mit UI-Markern. */
    availableFeatures: ComputedRef<FeatureRowMarkers[]>;
    /** Tier-Gruppierung für Drawer-Sektionen (CORE, ADVANCED, PRO, …). */
    featuresByTier: ComputedRef<Array<{ tier: string; rows: FeatureRowMarkers[] }>>;
    /** Toggle ohne Wurf: `plannedOnly` und gelocked-Features werden ignoriert. */
    toggleFeature: (key: FeatureKey) => void;
    /** Pre-Save-Validation. Wirft `PlannedOnlyFeatureError`, wenn nicht erlaubte Keys drin. */
    validateDraft: () => void;
    /** Snapshot der aktuellen Selection für den PATCH-Body. */
    snapshot: () => FeatureKey[];
}

const TIER_ORDER = ['CORE', 'ADVANCED', 'PRO', 'BUSINESS', 'ENTERPRISE_ONLY'];

function tierWeight(tier: string | undefined): number {
    if (!tier) return TIER_ORDER.length; // ungroupiert ans Ende
    const i = TIER_ORDER.indexOf(tier);
    return i === -1 ? TIER_ORDER.length : i;
}

/**
 * Plan-Editor-Discovery + Validation. Manifest liefert die Quelle der
 * Wahrheit (Catalog-Snapshot inklusive `plannedOnly`-Marker). Konsument
 * baut die Vue-Komponente und nutzt diesen Composable für State + Filter.
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
        if (plannedOnlySet.has(key)) return; // Roadmap-Feature, nicht buchbar
        const next = new Set(selectedFeatures.value);
        if (next.has(key)) {
            // Bei nonRegressive-Drafts darf ein Inherited-Feature nicht entfernt werden.
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
