<template>
    <div v-if="shown.length > 0 || note || readFailed" class="sp-feature-withdrawn-list">
        <p v-if="readFailed" class="sp-feature-withdrawn__error" role="alert">
            {{ i18n.featureWithdrawnLoadFailed }}
        </p>
        <p v-if="note" class="sp-feature-withdrawn__note" role="status">{{ note }}</p>
        <TenantCard v-for="withdrawal in shown" :key="withdrawal.withdrawalId">
            <section class="sp-feature-withdrawn" :aria-labelledby="headingOf(withdrawal)">
                <h2 :id="headingOf(withdrawal)" class="sp-feature-withdrawn__title">
                    {{ titleOf(withdrawal) }}
                </h2>
                <p class="sp-feature-withdrawn__text">
                    {{ messageText(i18n.featureWithdrawnReason, { reason: withdrawal.reason }) }}
                </p>
                <p v-if="withdrawal.liftedFrom" class="sp-feature-withdrawn__text">
                    {{
                        messageText(i18n.featureWithdrawnLifted, {
                            date: formatDate(withdrawal.liftedFrom),
                        })
                    }}
                </p>
                <ul v-if="withdrawal.lines.length > 0" class="sp-feature-withdrawn__lines">
                    <li v-for="line in withdrawal.lines" :key="line.subscriptionBundleId ?? 'plan'">
                        {{ lineText(line) }}
                    </li>
                </ul>
                <p v-if="withdrawal.specialTerms" class="sp-feature-withdrawn__text">
                    {{ i18n.featureWithdrawnSpecialTerms }}
                </p>
                <template v-if="isEndable(withdrawal)">
                    <p class="sp-feature-withdrawn__hint">{{ i18n.featureWithdrawnEndRight }}</p>
                    <div class="sp-feature-withdrawn__actions">
                        <TenantButton
                            v-for="subscriptionBundleId in withdrawal.endable.subscriptionBundleIds"
                            :key="subscriptionBundleId"
                            tone="danger"
                            @click="ask(withdrawal, subscriptionBundleId)"
                        >
                            {{
                                messageText(i18n.featureWithdrawnEndAddOn, {
                                    addOn: addOnName(withdrawal, subscriptionBundleId),
                                })
                            }}
                        </TenantButton>
                        <TenantButton
                            v-if="withdrawal.endable.subscription"
                            tone="danger"
                            @click="ask(withdrawal, null)"
                        >
                            {{ i18n.featureWithdrawnEndSubscription }}
                        </TenantButton>
                    </div>
                </template>
            </section>
        </TenantCard>

        <!--
            What ends, when, and what is credited, read from the server when the
            question is asked rather than reckoned here: the credit is the unused
            rest of what was charged, which only the account knows.
        -->
        <TenantDialog
            :model-value="asking !== null"
            :title="dialogTitle"
            size="sm"
            :persistent="ending"
            @update:model-value="
                (open: boolean) => {
                    if (!open) close();
                }
            "
        >
            <p v-if="previewing" class="sp-feature-withdrawn__text">{{ i18n.loading }}</p>
            <template v-else-if="preview">
                <p class="sp-feature-withdrawn__text">{{ dialogBody }}</p>
                <p class="sp-feature-withdrawn__text">{{ creditText }}</p>
            </template>
            <p v-if="dialogError" class="sp-feature-withdrawn__error" role="alert">
                {{ dialogError }}
            </p>

            <template #footer>
                <TenantButton :disabled="ending" @click="close">
                    {{ i18n.bundlePreviewClose }}
                </TenantButton>
                <TenantButton
                    variant="solid"
                    tone="danger"
                    :loading="ending"
                    :disabled="preview === null"
                    @click="confirm"
                >
                    {{ i18n.endAtOnceConfirm }}
                </TenantButton>
            </template>
        </TenantDialog>
    </div>
</template>

<script setup lang="ts">
// A feature the subscription holds is withdrawn for a reason outside the
// platform: what the subscriber was told — why, from when, what each line is
// reduced by — and, while it is missing, ending the subscription or one add-on
// at once, with what that credits read first.
//
// It loads what it shows itself, so the plan section only places it, and it
// says nothing at all where the installation does not withdraw features.

import { computed, ref, useId } from 'vue';
import type {
    EndAtOncePreview,
    EndedAtOnce,
    TenantFeatureWithdrawal,
    TenantFeatureWithdrawalLine,
} from '@saasicat/core';
import { useTenantFeatureWithdrawals, type HttpClient } from '@saasicat/ui-vue';

import { messageText } from '../message-parts.js';
import { refusalMessage } from '../refusal-of.js';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantCard from '../ui/TenantCard.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import '../ui/tenant-ui.css';

const props = defineProps<{
    http?: HttpClient;
    apiPrefix?: string;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string | Date) => string;
}>();

const emit = defineEmits<{
    /** The subscription or an add-on ended at once; the page reads what changed. */
    ended: [ended: EndedAtOnce];
}>();

const i18n = useTenantI18n();
const idPrefix = `sp-feature-withdrawn-${useId()}`;
const state = useTenantFeatureWithdrawals({ http: props.http, apiPrefix: props.apiPrefix });

const shown = computed(() => (state.available.value ? state.withdrawals.value : []));
// Said rather than left out: a subscriber not shown a withdrawal that reaches
// them would not know they may end at once.
const readFailed = computed(() => state.available.value && state.error.value !== null);

const headingOf = (withdrawal: TenantFeatureWithdrawal): string =>
    `${idPrefix}-${withdrawal.withdrawalId}`;

function titleOf(withdrawal: TenantFeatureWithdrawal): string {
    const ahead = new Date(withdrawal.effectiveFrom).getTime() > Date.now();
    return messageText(
        ahead ? i18n.value.featureWithdrawnTitleAhead : i18n.value.featureWithdrawnTitle,
        { feature: withdrawal.featureLabel, date: props.formatDate(withdrawal.effectiveFrom) },
    );
}

function lineText(line: TenantFeatureWithdrawalLine): string {
    const yearly = line.billingCycle === 'YEARLY';
    const name = `${line.label} (${yearly ? i18n.value.cycleYearly : i18n.value.cycleMonthly})`;
    if (line.reductionNet === null) {
        return messageText(i18n.value.featureWithdrawnNoReduction, { line: name });
    }
    if (!line.reduced) {
        return messageText(i18n.value.featureWithdrawnReductionEnded, { line: name });
    }
    return messageText(i18n.value.featureWithdrawnReduction, {
        line: name,
        amount: props.formatCurrency(line.reductionNet),
        unit: yearly ? i18n.value.wizardPriceUnitYearly : i18n.value.wizardPriceUnitMonthly,
    });
}

const isEndable = (withdrawal: TenantFeatureWithdrawal): boolean =>
    withdrawal.endable.subscription || withdrawal.endable.subscriptionBundleIds.length > 0;

function addOnName(withdrawal: TenantFeatureWithdrawal, subscriptionBundleId: string): string {
    const line = withdrawal.lines.find(
        (item) => item.subscriptionBundleId === subscriptionBundleId,
    );
    return line?.label ?? subscriptionBundleId;
}

// ── Ending at once ───────────────────────────────────────────────────────────

const asking = ref<{
    withdrawal: TenantFeatureWithdrawal;
    subscriptionBundleId: string | null;
} | null>(null);
const preview = ref<EndAtOncePreview | null>(null);
const previewing = ref(false);
const ending = ref(false);
const dialogError = ref<string | null>(null);
const note = ref<string | null>(null);

const refused = (err: unknown): string => refusalMessage(err, i18n.value.issueMessages);

// Which question is the open one; an answer to one closed or replaced meanwhile is dropped.
let question = 0;

async function ask(
    withdrawal: TenantFeatureWithdrawal,
    subscriptionBundleId: string | null,
): Promise<void> {
    const asked = ++question;
    asking.value = { withdrawal, subscriptionBundleId };
    preview.value = null;
    dialogError.value = null;
    note.value = null;
    previewing.value = true;
    try {
        const answer = await state.previewEnd(withdrawal.withdrawalId, subscriptionBundleId);
        if (asked === question) preview.value = answer;
    } catch (err) {
        if (asked === question) dialogError.value = refused(err);
    } finally {
        if (asked === question) previewing.value = false;
    }
}

function close(): void {
    if (ending.value) return;
    question += 1;
    asking.value = null;
    previewing.value = false;
}

const askedAddOn = computed(() => {
    const asked = asking.value;
    return asked?.subscriptionBundleId
        ? addOnName(asked.withdrawal, asked.subscriptionBundleId)
        : null;
});

const dialogTitle = computed(() =>
    askedAddOn.value === null
        ? i18n.value.endAtOnceTitleSubscription
        : messageText(i18n.value.endAtOnceTitleAddOn, { addOn: askedAddOn.value }),
);

const dialogBody = computed(() => {
    const endsAt = preview.value ? props.formatDate(preview.value.endsAt) : '';
    return askedAddOn.value === null
        ? messageText(i18n.value.endAtOnceBodySubscription, { date: endsAt })
        : messageText(i18n.value.endAtOnceBodyAddOn, { addOn: askedAddOn.value, date: endsAt });
});

const creditText = computed(() =>
    preview.value && preview.value.creditNet > 0
        ? messageText(i18n.value.endAtOnceCredit, {
              amount: props.formatCurrency(preview.value.creditNet),
          })
        : i18n.value.endAtOnceNoCredit,
);

async function confirm(): Promise<void> {
    const asked = asking.value;
    if (!asked || !preview.value) return;
    ending.value = true;
    dialogError.value = null;
    try {
        const ended = await state.end(asked.withdrawal.withdrawalId, asked.subscriptionBundleId);
        const addOn = askedAddOn.value;
        ending.value = false;
        asking.value = null;
        if (addOn !== null) note.value = messageText(i18n.value.endAtOnceEndedAddOn, { addOn });
        emit('ended', ended);
    } catch (err) {
        dialogError.value = refused(err);
        ending.value = false;
    }
}
</script>

<style scoped>
.sp-feature-withdrawn-list {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-feature-withdrawn {
    padding: var(--sa-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-feature-withdrawn__title {
    margin: 0;
    font-size: var(--sa-text-lg);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.sp-feature-withdrawn__text {
    margin: 0;
    color: var(--sa-color-fg-body);
    overflow-wrap: anywhere;
}
.sp-feature-withdrawn__lines {
    margin: 0;
    padding-left: var(--sa-space-5);
}
.sp-feature-withdrawn__hint,
.sp-feature-withdrawn__note {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
.sp-feature-withdrawn__error {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-negative-fg);
}
.sp-feature-withdrawn__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--sa-space-2);
}
</style>
