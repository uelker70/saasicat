<template>
    <AdminDialog
        :model-value="flow.target.value !== null"
        :title="
            formatMessage(msg.retireDialog.title, { version: flow.target.value?.version ?? '' })
        "
        size="md"
        persistent
        @update:model-value="(open: boolean) => !open && flow.close()"
    >
        <div v-if="flow.result.value">
            <AdminBanner tone="positive">
                {{
                    formatMessage(msg.retireDialog.done, {
                        told: flow.result.value.told,
                        failed: flow.result.value.failed,
                    })
                }}
            </AdminBanner>
        </div>
        <div v-else class="sa-retire">
            <p class="text-body2">
                {{
                    formatMessage(msg.retireDialog.intro, {
                        version: flow.target.value?.version ?? '',
                        planKey: plan.planKey,
                    })
                }}
            </p>
            <q-select
                :model-value="flow.replacementPlanId.value"
                :options="planOptions"
                :label="msg.retireDialog.planLabel"
                emit-value
                map-options
                :disable="flow.loading.value || flow.announcing.value"
                @update:model-value="(id: string | null) => flow.choosePlan(id)"
            />
            <q-linear-progress v-if="flow.loading.value" indeterminate class="q-mt-sm" />

            <AdminBanner v-if="noVersionOnSale" tone="warning" class="q-mt-md">
                {{ noVersionOnSale }}
            </AdminBanner>

            <template v-if="preview">
                <section class="q-mt-md" :aria-label="replacementText">
                    <div class="text-subtitle2">{{ replacementText }}</div>
                    <dl class="sa-retire__prices">
                        <template v-for="row in priceRows" :key="row.label">
                            <dt>{{ row.label }}</dt>
                            <dd>{{ row.text }}</dd>
                        </template>
                    </dl>
                    <p v-if="otherChanges > 0" class="text-caption">
                        {{ formatMessage(msg.retireDialog.otherChanges, { count: otherChanges }) }}
                    </p>
                </section>

                <section class="q-mt-md" :aria-label="reachedTitle">
                    <div class="text-subtitle2">{{ reachedTitle }}</div>
                    <ul class="sa-retire__list">
                        <li v-for="date in dates" :key="date.effectiveAt">
                            {{
                                formatMessage(msg.retireDialog.dateRow, {
                                    count: date.count,
                                    date: formatDate(date.effectiveAt),
                                    lastDay: formatDate(date.lastDayToCancel),
                                })
                            }}
                        </li>
                    </ul>
                </section>

                <section
                    v-if="skips.length > 0"
                    class="q-mt-md"
                    :aria-label="msg.retireDialog.skippedTitle"
                >
                    <div class="text-subtitle2">{{ msg.retireDialog.skippedTitle }}</div>
                    <ul class="sa-retire__list">
                        <li v-for="skip in skips" :key="skip.reason">
                            {{ formatMessage(skipText[skip.reason], { count: skip.count }) }}
                        </li>
                    </ul>
                </section>

                <AdminBanner
                    v-for="blocker in preview.blockers"
                    :key="blocker.code"
                    tone="negative"
                    class="q-mt-md"
                >
                    {{ blockerText(blocker, msg.retireDialog.blockers) }}
                </AdminBanner>
            </template>
        </div>

        <template #footer>
            <AdminBanner v-if="flow.error.value" tone="negative">{{
                flow.error.value
            }}</AdminBanner>
            <div class="sa-dialog__actions">
                <q-btn
                    flat
                    :label="flow.result.value ? common.close : common.cancel"
                    @click="flow.close()"
                />
                <q-btn
                    v-if="!flow.result.value"
                    color="primary"
                    :label="msg.retireDialog.announce"
                    :loading="flow.announcing.value"
                    :disable="!canAnnounce"
                    @click="flow.announce()"
                />
            </div>
        </template>
    </AdminDialog>
</template>

<script setup lang="ts">
// Retiring a plan version for the subscriptions on it: the plan they continue
// on, what changes in price, whom it reaches and when, and what refuses it.
// The flow is `useVersionRetirement`'s; this only draws it.

import { computed } from 'vue';
import type { PlanRow, RetirementSkipReason } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import { blockerText, retirementDates, retirementSkips } from '../../client/version-retirement.js';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminDialog from '../../ui/overlay/AdminDialog.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { VersionRetirementFlow } from '../../vue/use-version-retirement.js';

const props = defineProps<{
    flow: VersionRetirementFlow;
    plan: PlanRow;
    formatMoney: (raw: string | number) => string;
    formatDate: (iso: string | null | undefined) => string;
}>();

const msg = useSaMessages('planDetail');
const common = useSaMessages('common');

const preview = computed(() => props.flow.preview.value);
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
const priceRows = computed(() => {
    const shown = preview.value;
    if (!shown) return [];
    const price = (net: number | null) =>
        net === null ? msg.value.retireDialog.notSold : props.formatMoney(net);
    const row = (label: string, from: number | null, to: number | null) => ({
        label,
        text: formatMessage(msg.value.retireDialog.priceChange, {
            from: price(from),
            to: price(to),
        }),
    });
    return [
        row(
            msg.value.retireDialog.priceMonthly,
            shown.retired.monthlyNet,
            shown.replacement.monthlyNet,
        ),
        row(
            msg.value.retireDialog.priceYearly,
            shown.retired.yearlyNet,
            shown.replacement.yearlyNet,
        ),
    ];
});
const otherChanges = computed(
    () =>
        preview.value?.changes.filter(
            (change) => change.field !== 'monthlyNet' && change.field !== 'yearlyNet',
        ).length ?? 0,
);
const reachedTitle = computed(() =>
    formatMessage(msg.value.retireDialog.reachedTitle, {
        count: preview.value?.reached.length ?? 0,
    }),
);
const dates = computed(() => (preview.value ? retirementDates(preview.value) : []));
const skips = computed(() => (preview.value ? retirementSkips(preview.value) : []));
const skipText = computed<Record<RetirementSkipReason, string>>(() => ({
    ended: msg.value.retireDialog.skipped.ended,
    'cancelled-before': msg.value.retireDialog.skipped.cancelledBefore,
    'changes-before': msg.value.retireDialog.skipped.changesBefore,
    'no-term': msg.value.retireDialog.skipped.noTerm,
    'already-told': msg.value.retireDialog.skipped.alreadyTold,
}));
const canAnnounce = computed(
    () =>
        !props.flow.loading.value && preview.value !== null && preview.value.blockers.length === 0,
);
</script>

<style scoped>
.sa-retire__prices {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--sa-space-1) var(--sa-space-3);
    margin: var(--sa-space-2) 0 0;
}

.sa-retire__prices dd {
    margin: 0;
}

.sa-retire__list {
    margin: var(--sa-space-2) 0 0;
    padding-left: var(--sa-space-4);
}
</style>
