// What the plan wizard's steps need from the page that owns them.
//
// `PlansPage` loads the plans, their versions and the catalog, and derives the
// registries the editor and the review render from. Those two steps are now
// their own routes — children of the plans route, so the page stays mounted and
// nothing is loaded twice — and this is the seam they read it through.
//
// It lives in `features/plan/` rather than in `src/vue/` because the shapes it
// carries are the plan editor's, and `vue/` may not read `features/` — the
// layer rule saying, correctly, that this is domain context and not a general
// composable.
//
// Provided rather than passed as props for the reason AP3 §3.2 gives: a route
// component is mounted by the router, which passes nothing. The alternative was
// to make each step re-derive the same twelve values from the same resources,
// which is the same decision in two places and the version of it that drifts.

import { inject, provide, type ComputedRef, type InjectionKey, type Ref } from 'vue';

import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import type {
    BundleEntry,
    DiscoveryFeature,
    DiscoveryQuota,
} from './internal/plan-version-editor.types.js';

/** What the editor hands forward when the operator presses "next". */
export interface EditorFormPayload {
    version: number;
    features: string[];
    bundles: string[];
    quotas: Record<string, number>;
    monthlyNet: string;
    yearlyNet: string;
    changeNote: string;
    marketed: boolean;
    validFrom: string | null;
    validUntil: string | null;
}

export interface PlanAreaContext {
    /** The plan the wizard is in, or `null` when none is selected. */
    plan: Ref<PlanRow | null>;
    /** Every version of that plan, newest number last. */
    versions: Ref<PlanVersionRow[]>;
    /** Everything the code declares, for the editor's pickers. */
    availableFeatures: Ref<DiscoveryFeature[]>;
    availableQuotas: Ref<DiscoveryQuota[]>;
    availableBundles: Ref<BundleEntry[]>;
    featureRegistry: ComputedRef<Record<string, { label?: string; group?: string }>>;
    /** Tenants per plan key, for the review's impact count. */
    tenantCounts: ComputedRef<Record<string, number>>;
    /** True while a draft is being written. */
    saving: Ref<boolean>;
    /** True while a version is being published. */
    publishing: Ref<boolean>;
    /** The last write failure, or `null`. */
    saveError: Ref<string | null>;
    /**
     * Persists the draft, and says whether it was written.
     *
     * `false` means the write was refused or failed, with the reason in
     * `saveError`. The step keeps the operator's form on screen for it — a
     * step that navigated away on a rejected save discarded the version and
     * took the error message with it, which is how a failed save reads as a
     * successful one.
     */
    saveDraft: (payload: EditorFormPayload, editingId: string | null) => Promise<boolean>;
    /**
     * Persists the draft and publishes it, and says whether that happened.
     *
     * Takes the draft rather than reading the page's copy of it. The wizard's
     * form lives in the step; the page's copy is written by `saveDraft`, so a
     * publish that read it published whatever had last been saved — and before
     * a save, nothing at all: the operation returned at its first guard and the
     * step navigated away as if it had worked.
     */
    publishDraft: (
        payload: EditorFormPayload,
        editingId: string | null,
        options: { forceRegressive: boolean; allowZeroPrice: boolean },
    ) => Promise<boolean>;
}

/**
 * Route meta marking a record as a step rendered INSIDE the plan page.
 *
 * The page reads it to decide whether it still owns the hero. Meta rather than
 * a path comparison because the consumer chooses the admin base path, and
 * rather than a `mode` ref because the router already knows the answer — the
 * ref that used to hold it stopped being assigned when the steps became routes,
 * and a condition asking it was simply false forever.
 */
export const PLAN_STEP_META = 'saasicatPlanStep';

/** Vue inject key for the plan area (see the `Symbol.for` note in super-admin-context.ts). */
export const PLAN_AREA_KEY: InjectionKey<PlanAreaContext> = Symbol.for('saasicat/ui-vue/PLAN_AREA');

export function providePlanArea(context: PlanAreaContext): void {
    provide(PLAN_AREA_KEY, context);
}

/**
 * The plan area.
 *
 * Throws rather than answering with an empty context: a wizard step mounted
 * outside the plans route has no plan, no versions and no way to save, and a
 * page that renders an empty editor is harder to diagnose than one that says
 * where it should have been mounted.
 */
export function usePlanArea(): PlanAreaContext {
    const context = inject(PLAN_AREA_KEY, null);
    if (!context) {
        throw new Error(
            'usePlanArea(): no plan area in scope. The plan editor and review are children of ' +
                'the `plans` route — mounting one outside it leaves it without the plan, its ' +
                'versions and the catalog it renders from.',
        );
    }
    return context;
}
