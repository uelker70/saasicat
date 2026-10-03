<template>
    <VersionRetireDialog
        :flow="flow"
        :texts="msg.retireDialog"
        :intro="intro"
        :replacement="replacementText"
        :no-version-on-sale="noVersionOnSale"
        :skip-lines="skipLines"
    >
        <q-select
            :model-value="flow.replacementPlanId.value"
            :options="planOptions"
            :label="msg.retireDialog.planLabel"
            emit-value
            map-options
            :disable="flow.loading.value || flow.announcing.value"
            @update:model-value="(id: string | null) => flow.choosePlan(id)"
        />
    </VersionRetireDialog>
</template>

<script setup lang="ts">
// Retiring a plan version for the subscriptions on it, onto a version of the
// plan chosen here. The flow is `useVersionRetirement`'s, and the dialog is the
// one an add-on version is retired with; this adds the plan to continue on and
// the plan area's words.

import { computed } from 'vue';
import type { PlanRow, RetirementSkipReason } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import { retirementSkipLines } from '../../client/version-retirement.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { VersionRetirementFlow } from '../../vue/use-version-retirement.js';
import VersionRetireDialog from '../retirement/VersionRetireDialog.vue';

const props = defineProps<{
    flow: VersionRetirementFlow;
    plan: PlanRow;
}>();

const msg = useSaMessages('planDetail');

const preview = computed(() => props.flow.preview.value);
const intro = computed(() =>
    formatMessage(msg.value.retireDialog.intro, {
        version: props.flow.target.value?.version ?? '',
        planKey: props.plan.planKey,
    }),
);
const planOptions = computed(() =>
    props.flow.plans.value.map((plan) => ({ label: plan.label || plan.planKey, value: plan.id })),
);
const noVersionOnSale = computed(() => {
    const flow = props.flow;
    const chosen = flow.plans.value.find((plan) => plan.id === flow.replacementPlanId.value);
    if (!chosen || flow.loading.value || flow.replacement.value) return '';
    return formatMessage(msg.value.retireDialog.noVersionOnSale, { planKey: chosen.planKey });
});
const replacementText = computed(() =>
    preview.value
        ? formatMessage(msg.value.retireDialog.replacement, {
              planKey: preview.value.replacement.planKey,
              version: preview.value.replacement.version,
          })
        : '',
);
const skipLines = computed(() => {
    const words = msg.value.retireDialog.skipped;
    const sentences: Record<RetirementSkipReason, string> = {
        ended: words.ended,
        'cancelled-before': words.cancelledBefore,
        'changes-before': words.changesBefore,
        'no-term': words.noTerm,
        'already-told': words.alreadyTold,
    };
    return preview.value ? retirementSkipLines(preview.value, sentences) : [];
});
</script>
