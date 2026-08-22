<template>
    <PlanReview
        v-if="area.plan.value && wizard.editing.value"
        :plan="area.plan.value"
        :version="reviewVersion"
        :predecessor="predecessor"
        :available-quotas="area.availableQuotas.value"
        :available-bundles="area.availableBundles.value"
        :feature-registry="area.featureRegistry.value"
        :tenant-impact-count="area.tenantCounts.value[area.plan.value.planKey] ?? 0"
        :saving="area.saving.value"
        :publishing="area.publishing.value"
        :publish-error="area.saveError.value"
        @back="onBack"
        @save-and-exit="onSaveAndExit"
        @publish="onPublish"
    />
    <AdminEmptyState v-else :title="msg.list.emptyNoPlans" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import PlanReview from '../features/plan/PlanReview.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import { usePlanArea } from '../features/plan/plan-area-context.js';
import { usePlanWizard } from '../vue/plan-wizard.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

// Step 3 of the plan-version wizard, as its own route.
//
// The version it renders is BUILT from the editor's form, not read back from
// the server — nothing has been written at this point, and that is the whole
// purpose of the step: look at the impact before committing to it. Going back
// therefore returns to a form that still holds every value.
const router = useRouter();
const area = usePlanArea();
const wizard = usePlanWizard();
const msg = useSaMessages('plans');

/** The unsaved version the review renders, assembled from the wizard's form. */
const reviewVersion = computed(() => {
    const form = wizard.editing.value?.initialForm;
    const nowIso = new Date().toISOString();
    return {
        id: wizard.editing.value?.editingId ?? '',
        planId: area.plan.value?.planKey ?? '',
        version: form?.version ?? 1,
        baseVersionId: null,
        features: [...(form?.features ?? [])],
        bundles: [],
        quotas: { ...(form?.quotas ?? {}) },
        monthlyNet: form?.monthlyNet ?? '0.00',
        yearlyNet: form?.yearlyNet ?? '0.00',
        marketed: form?.marketed ?? true,
        publishedAt: null,
        supersededAt: null,
        publishedChanges: null,
        changeNote: form?.changeNote ?? '',
        nonRegressive: true,
        validFrom: form?.validFrom ?? null,
        validUntil: form?.validUntil ?? null,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
    };
});

/** The version this draft would supersede. */
const predecessor = computed(() => {
    const live = area.versions.value.filter(
        (v) => v.publishedAt !== null && v.supersededAt === null,
    );
    if (live.length === 0) return null;
    return live.reduce((a, b) => (a.version > b.version ? a : b));
});

/** Step 3 → step 2. The form is untouched, so nothing has to be restored. */
function onBack(): void {
    void router.push('/admin/plans/version/edit');
}

/**
 * Leaves the wizard, but only once the draft is on the server.
 *
 * A refused write keeps the operator here with their form and the reason for
 * it. Resetting first is what turned a failed save into a silent one: the
 * version was gone, the route had changed, and the error the page had just
 * recorded was rendered by a page nobody was looking at any more.
 */
async function onSaveAndExit(): Promise<void> {
    const form = wizard.editing.value?.initialForm;
    if (!form) return;
    const saved = await area.saveDraft(
        { ...form, bundles: [] },
        wizard.editing.value?.editingId ?? null,
    );
    if (!saved) return;
    leaveWizard();
}

/**
 * Publishes what is on screen — the form, and the checklist's own flags.
 *
 * Both travel with the call. The page used to publish `area`'s copy of the
 * draft, which only a save had ever written, and to drop the flags the
 * operator had just ticked.
 */
async function onPublish(payload: {
    forceRegressive: boolean;
    allowZeroPrice: boolean;
}): Promise<void> {
    const form = wizard.editing.value?.initialForm;
    if (!form) return;
    const published = await area.publishDraft(
        { ...form, bundles: [] },
        wizard.editing.value?.editingId ?? null,
        payload,
    );
    if (!published) return;
    leaveWizard();
}

function leaveWizard(): void {
    wizard.reset();
    void router.push('/admin/plans');
}
</script>
