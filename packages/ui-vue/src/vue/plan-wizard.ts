// The plan-version wizard's state, and why it does not live in a page.
//
// Creating or editing a plan version is three steps — pick, edit, review —
// and the draft between the last two is NOT saved. `PlanVersionEditor` hands a
// form payload forward, `PlanReview` renders it, and going back hands it
// straight into the editor again. Nothing has touched the server yet; that is
// deliberate, so an operator can look at the impact before committing to it.
//
// Once those steps became routes, that draft had nowhere to live: navigating
// unmounts the page it was held in, and an operator pressing "back" from the
// review would have found an empty form. So the state is provided by the route
// the three steps share, and lives exactly as long as the operator is inside
// the plans area.
//
// `tests-component/plan-wizard-keeps-its-draft.test.ts` holds it to that.

import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';

/** The form the editor starts from. Shaped by the editor, not by the API. */
export interface PlanDraftForm {
    version: number;
    features: string[];
    /**
     * The bundles the editor derived from the features — every bundle whose
     * features are all selected. Carried rather than recomputed so the review
     * publishes exactly what the editor showed.
     */
    bundles: string[];
    quotas: Record<string, number>;
    monthlyNet: string;
    yearlyNet: string;
    changeNote: string;
    marketed: boolean;
    validFrom: string | null;
    validUntil: string | null;
}

/** What the editor is working on: an existing draft, or a new one (`null`). */
export interface PlanDraftEditing {
    editingId: string | null;
    initialForm: PlanDraftForm;
}

export interface PlanWizardState {
    /** Which plan the wizard is in. Set when a step is entered. */
    planKey: Ref<string | null>;
    /** The editor's starting values, or `null` when no draft is open. */
    editing: Ref<PlanDraftEditing | null>;
    /**
     * The version object the review renders — built from the editor's form, not
     * read back from the server, because nothing has been saved at that point.
     */
    review: Ref<Record<string, unknown> | null>;
    /** Clears everything. Called when the operator leaves the wizard. */
    reset: () => void;
}

/** Vue inject key for the wizard (see the `Symbol.for` note in super-admin-context.ts). */
export const PLAN_WIZARD_KEY: InjectionKey<PlanWizardState> = Symbol.for(
    'saasicat/ui-vue/PLAN_WIZARD',
);

/** Creates the state and provides it to the subtree. Called by the plans route. */
export function providePlanWizard(): PlanWizardState {
    const planKey = ref<string | null>(null);
    const editing = ref<PlanDraftEditing | null>(null);
    const review = ref<Record<string, unknown> | null>(null);

    const state: PlanWizardState = {
        planKey,
        editing,
        review,
        reset() {
            planKey.value = null;
            editing.value = null;
            review.value = null;
        },
    };
    provide(PLAN_WIZARD_KEY, state);
    return state;
}

/**
 * The wizard state.
 *
 * Falls back to a fresh, unshared instance when nothing provided one, so a step
 * mounted on its own in a test renders instead of throwing — it simply starts
 * with an empty draft, which is what a deep link into the editor means anyway.
 */
export function usePlanWizard(): PlanWizardState {
    const provided = inject(PLAN_WIZARD_KEY, null);
    if (provided) return provided;

    const planKey = ref<string | null>(null);
    const editing = ref<PlanDraftEditing | null>(null);
    const review = ref<Record<string, unknown> | null>(null);
    return {
        planKey,
        editing,
        review,
        reset() {
            planKey.value = null;
            editing.value = null;
            review.value = null;
        },
    };
}
