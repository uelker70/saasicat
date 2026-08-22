<template>
    <PlanVersionEditor
        v-if="area.plan.value && wizard.editing.value"
        :plan-key="area.plan.value.planKey"
        :editing-id="wizard.editing.value.editingId"
        :initial-form="wizard.editing.value.initialForm"
        :saving="area.saving.value"
        :available-features="area.availableFeatures.value"
        :available-quotas="area.availableQuotas.value"
        :available-bundles="area.availableBundles.value"
        :feature-registry="area.featureRegistry.value"
        :plan-display-name="area.plan.value.label"
        :save-error="area.saveError.value"
        :predecessor-version="predecessor"
        @save="onNext"
        @cancel="onCancel"
    />
    <AdminEmptyState v-else :title="msg.list.emptyNoPlans" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import PlanVersionEditor from '../features/plan/PlanVersionEditor.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import { usePlanArea, type EditorFormPayload } from '../features/plan/plan-area-context.js';
import { usePlanWizard } from '../vue/plan-wizard.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
import type { PredecessorVersion } from '../features/plan/internal/plan-version-editor.types.js';

// Step 2 of the plan-version wizard, as its own route.
//
// It holds no data: the plan, its versions and the catalog come from the plans
// route it is a child of, and the draft it edits lives in the wizard state that
// route provides. That is what lets an operator go forward to the review and
// back again without losing what they typed — nothing has been saved yet at
// either point.
const router = useRouter();
const area = usePlanArea();
const wizard = usePlanWizard();
const msg = useSaMessages('plans');

/**
 * The version this draft would supersede: the published one with the highest
 * number, excluding the draft itself. `null` for a first version.
 */
const predecessor = computed<PredecessorVersion | null>(() => {
    const editingId = wizard.editing.value?.editingId ?? null;
    const published = area.versions.value.filter(
        (v) => v.publishedAt !== null && v.supersededAt === null && v.id !== editingId,
    );
    if (published.length === 0) return null;
    const latest = published.reduce((a, b) => (a.version > b.version ? a : b));
    // Projected, not passed whole: the editor needs six fields to check that a
    // draft starts after its predecessor, and handing it a full row would let a
    // later field rename compile while the check silently read `undefined`.
    return {
        version: latest.version,
        features: [...latest.features],
        quotas: { ...(latest.quotas ?? {}) },
        monthlyNet: latest.monthlyNet,
        yearlyNet: latest.yearlyNet,
        validFrom: latest.validFrom,
    };
});

/** Step 2 → step 3. Carries the FORM forward, not anything the server holds. */
function onNext(payload: EditorFormPayload): void {
    wizard.editing.value = {
        editingId: wizard.editing.value?.editingId ?? null,
        initialForm: { ...payload },
    };
    void router.push(`${plansBase()}/review`);
}

function onCancel(): void {
    wizard.reset();
    void router.push(plansBase());
}

function plansBase(): string {
    return '/admin/plans';
}
</script>
