<template>
    <AdminFormDialog
        :model-value="flow.isOpen.value"
        :title="msg.dialog.title"
        size="lg"
        :submit-label="msg.dialog.announce"
        :submit-disabled="!flow.canAnnounce.value"
        :submit="flow.submit"
        :success-message="msg.dialog.done"
        @update:model-value="(open: boolean) => !open && flow.close()"
    >
        <div class="sa-withdraw">
            <p class="text-body2">{{ msg.dialog.intro }}</p>
            <AdminFieldGrid>
                <AdminField :label="msg.dialog.feature" required>
                    <q-select
                        :model-value="flow.featureKey.value"
                        :options="featureOptions"
                        emit-value
                        map-options
                        outlined
                        dense
                        :disable="flow.announcing.value"
                        @update:model-value="(key: string | null) => flow.chooseFeature(key)"
                    />
                </AdminField>
                <AdminField :label="msg.dialog.effectiveFrom" :hint="dateHint">
                    <q-input
                        :model-value="flow.effectiveFrom.value"
                        type="datetime-local"
                        outlined
                        dense
                        :disable="flow.announcing.value"
                        @update:model-value="(value) => flow.chooseDate(String(value ?? ''))"
                    />
                </AdminField>
            </AdminFieldGrid>
            <AdminField :label="msg.dialog.reason" required>
                <q-input
                    :model-value="flow.reason.value"
                    type="textarea"
                    autogrow
                    outlined
                    dense
                    counter
                    :maxlength="FEATURE_WITHDRAWAL_REASON_MAX_LENGTH"
                    :disable="flow.announcing.value"
                    @update:model-value="(value) => flow.setReason(String(value ?? ''))"
                />
            </AdminField>

            <q-linear-progress v-if="flow.loading.value" indeterminate class="q-mt-sm" />

            <template v-if="preview">
                <section class="q-mt-md" :aria-label="reachedTitle">
                    <div class="text-subtitle2">{{ reachedTitle }}</div>
                    <p v-if="reach.subscriptions === 0" class="text-body2">
                        {{ msg.dialog.nothingReached }}
                    </p>
                    <ul
                        v-if="reach.specialTermsOnly > 0 || reach.endingBefore > 0"
                        class="sa-withdraw__list"
                    >
                        <li v-if="reach.specialTermsOnly > 0">
                            {{
                                formatMessage(msg.dialog.specialTerms, {
                                    count: reach.specialTermsOnly,
                                })
                            }}
                        </li>
                        <li v-if="reach.endingBefore > 0">
                            {{
                                formatMessage(msg.dialog.endingBefore, {
                                    count: reach.endingBefore,
                                })
                            }}
                        </li>
                    </ul>
                </section>

                <section
                    v-if="preview.targets.length > 0"
                    class="q-mt-md"
                    :aria-label="msg.dialog.reductionsTitle"
                >
                    <div class="text-subtitle2">{{ msg.dialog.reductionsTitle }}</div>
                    <p class="text-caption">{{ msg.dialog.reductionsIntro }}</p>
                    <div v-for="target in targets" :key="target.key" class="sa-withdraw__target">
                        <div class="sa-withdraw__target-name">
                            <div>{{ target.title }}</div>
                            <div class="text-caption">{{ target.lines }}</div>
                        </div>
                        <q-input
                            :model-value="flow.amounts.value[target.key] ?? null"
                            type="number"
                            step="0.01"
                            min="0"
                            outlined
                            dense
                            :label="msg.dialog.amount"
                            :error="target.problem !== ''"
                            :error-message="target.problem"
                            :disable="flow.announcing.value"
                            @update:model-value="(value) => flow.setAmount(target.key, value)"
                        />
                    </div>
                </section>

                <AdminBanner
                    v-for="blocker in preview.blockers"
                    :key="blocker.code"
                    tone="negative"
                    class="q-mt-md"
                >
                    {{ blockerSentence(blocker) }}
                </AdminBanner>
            </template>
        </div>

        <AdminBanner v-if="flow.error.value" tone="negative" class="q-mt-md">
            {{ flow.error.value }}
        </AdminBanner>
    </AdminFormDialog>
</template>

<script setup lang="ts">
// Withdrawing a feature from everybody who holds it: which feature, from when,
// why, whom it reaches, and what each plan and add-on in each rhythm is reduced
// by. The flow is `useFeatureWithdrawalAnnouncement`'s; this draws it.

import { computed } from 'vue';
import {
    FEATURE_WITHDRAWAL_REASON_MAX_LENGTH,
    type FeatureWithdrawalBlocker,
} from '@saasicat/core';

import {
    featureWithdrawalReachOf,
    featureWithdrawalTargetKeyOf,
} from '../../client/feature-withdrawal.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { formatDay, formatMessage } from '../../client/i18n/format.js';
import { browserTimeZone } from '../../client/maintenance-times.js';
import { blockerText } from '../../client/version-retirement.js';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import AdminFieldGrid from '../../ui/page/AdminFieldGrid.vue';
import type { FeatureWithdrawalAnnouncementFlow } from '../../vue/use-feature-withdrawal-announcement.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{ flow: FeatureWithdrawalAnnouncementFlow }>();

const msg = useSaMessages('featureWithdrawals');
const common = useSaMessages('common');
const { locale, intlLocale } = useSuperAdminI18n();

const preview = computed(() => props.flow.preview.value);
const dateHint = formatMessage(msg.value.dialog.effectiveFromHint, { zone: browserTimeZone() });

const featureOptions = computed(() =>
    props.flow.features.value.map((feature) => ({
        label: `${feature.label} (${feature.featureKey})`,
        value: feature.featureKey,
    })),
);

const reach = computed(() =>
    preview.value
        ? featureWithdrawalReachOf(preview.value)
        : { subscriptions: 0, specialTermsOnly: 0, endingBefore: 0 },
);
const reachedTitle = computed(() =>
    formatMessage(msg.value.dialog.reachedTitle, { count: reach.value.subscriptions }),
);

const price = (net: number | null): string =>
    net === null ? msg.value.dialog.priceUnknown : formatCurrency(net, locale.value);

const targets = computed(() =>
    (preview.value?.targets ?? []).map((target) => {
        const key = featureWithdrawalTargetKeyOf(target);
        const problem = props.flow.read.value.problems[key];
        return {
            key,
            title: formatMessage(msg.value.dialog.target, {
                label: target.label,
                key: target.key,
                cycle:
                    target.billingCycle === 'YEARLY' ? common.value.yearly : common.value.monthly,
            }),
            lines: formatMessage(msg.value.dialog.targetLines, {
                lines: target.lines,
                price: price(target.lowestPriceNet),
            }),
            problem: problem
                ? formatMessage(msg.value.dialog.problems[problem], {
                      price: price(target.lowestPriceNet),
                  })
                : '',
        };
    }),
);

/** A blocker in the operator's words, its date written the way they read one. */
function blockerSentence(blocker: FeatureWithdrawalBlocker): string {
    const { date } = blocker.params;
    const params =
        typeof date === 'string'
            ? { ...blocker.params, date: formatDay(date, intlLocale.value) }
            : blocker.params;
    return blockerText({ ...blocker, params }, msg.value.dialog.blockers);
}
</script>

<style scoped>
.sa-withdraw__list {
    margin: var(--sa-space-2) 0 0;
    padding-left: var(--sa-space-4);
}

.sa-withdraw__target {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--sa-space-3);
    align-items: start;
    margin-top: var(--sa-space-2);
}

.sa-withdraw__target-name {
    min-width: 0;
    overflow-wrap: anywhere;
}
</style>
