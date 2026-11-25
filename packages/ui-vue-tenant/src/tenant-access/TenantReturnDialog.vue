<template>
    <TenantDialog
        :model-value="modelValue"
        :title="i18n.returnAction"
        size="lg"
        :persistent="submitting"
        @update:model-value="
            (open: boolean) => {
                if (!open) close();
            }
        "
    >
        <p class="sp-return__intro">{{ i18n.returnIntro }}</p>

        <p v-if="catalog.loading.value && plans.length === 0" class="sp-return__note" role="status">
            {{ i18n.loading }}
        </p>
        <p v-else-if="catalog.error.value" class="sp-return__error" role="alert">
            {{ i18n.returnPlansLoadFailed }}
        </p>
        <p v-else-if="plans.length === 0" class="sp-return__note">{{ i18n.returnNoPlans }}</p>
        <template v-else>
            <PlanCycleToggle
                :model-value="cycle"
                :i18n="cycleI18n"
                class="sp-return__cycle"
                @update:model-value="choose(plan, $event)"
            />
            <PlanGrid
                :model-value="plan"
                :plans="plans"
                :cycle="cycle"
                :catalog-quota-keys="quotaKeys"
                :format-currency="formatCurrency"
                :format-quota-value="quotaValue"
                :quota-label="quotaLabelOf"
                :i18n="gridI18n"
                @update:model-value="choose($event, cycle)"
            />
        </template>

        <section v-if="plan" class="sp-return__terms" aria-live="polite">
            <p v-if="previewLoading" class="sp-return__note" role="status">{{ i18n.loading }}</p>
            <p v-else-if="previewError" class="sp-return__error" role="alert">{{ previewError }}</p>
            <p v-else-if="refusedSentence" class="sp-return__error" role="alert">
                {{ refusedSentence }}
            </p>
            <template v-else-if="terms && lines">
                <p v-if="lines.price" class="sp-return__price">{{ lines.price }}</p>
                <p class="sp-return__line">{{ lines.period }}</p>
                <p class="sp-return__line">{{ lines.notice }}</p>
                <p class="sp-return__line">{{ lines.deletion }} {{ lines.afterwards }}</p>

                <div v-if="terms.blockers.length > 0" class="sp-return__blockers">
                    <p class="sp-return__heading">{{ i18n.wizardBlockersTitle }}</p>
                    <ul>
                        <li
                            v-for="(blocker, index) in terms.blockers"
                            :key="`${blocker.code}:${index}`"
                        >
                            {{ issueSentence(blocker, i18n.issueMessages, formatDate) }}
                        </li>
                    </ul>
                </div>

                <div v-if="terms.paymentMethodRequired" class="sp-return__payment">
                    <p class="sp-return__heading">{{ paymentMethodFirst }}</p>
                    <TenantPaymentMethodCard
                        v-if="holdsBillingPermission"
                        :http="http"
                        :api-prefix="apiPrefix"
                        :format-date="formatDate"
                        :separated="false"
                    />
                    <p v-else class="sp-return__line">{{ i18n.returnPaymentMethodByBilling }}</p>
                </div>

                <div v-if="submitError" class="sp-return__error" role="alert">
                    <p class="sp-return__line">{{ submitError }}</p>
                    <ul v-if="submitBlockers.length > 0">
                        <li
                            v-for="(blocker, index) in submitBlockers"
                            :key="`${blocker.code}:${index}`"
                        >
                            {{ issueSentence(blocker, i18n.issueMessages, formatDate) }}
                        </li>
                    </ul>
                </div>
            </template>
        </section>

        <template #footer>
            <TenantButton :disabled="submitting" @click="close">
                {{ i18n.bundlePreviewClose }}
            </TenantButton>
            <TenantButton
                variant="solid"
                tone="accent"
                :loading="submitting"
                :disabled="!confirmable"
                @click="confirm"
            >
                {{ submitting ? i18n.returnConfirmInProgress : i18n.returnConfirm }}
            </TenantButton>
        </template>
    </TenantDialog>
</template>

<script setup lang="ts">
import {
    useSuperAdminI18n,
    useTenantBillingCatalog,
    useTenantReturn,
    type BillingCycleStr,
    type CatalogPlan,
    type HttpClient,
    type PlanChangePreviewIssueShape,
    type SubscriptionReturnPreviewShape,
    type SubscriptionReturnedShape,
} from '@saasicat/ui-vue';
import { computed, ref, watch } from 'vue';

import { defaultQuotaValue } from '../plan/quota-value.js';
import PlanCycleToggle from '../plan/PlanCycleToggle.vue';
import PlanGrid from '../plan/PlanGrid.vue';
import { issueSentence, refusalMessage } from '../refusal-of.js';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantPaymentMethodCard from '../TenantPaymentMethodCard.vue';
import TenantButton from '../ui/TenantButton.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import '../ui/tenant-ui.css';
import {
    catalogueNetOf,
    mayConfirmReturn,
    paymentMethodFirstSentence,
    quotaKeysOf,
    returnRefusalSentence,
    returnRefused,
    returnTermsLines,
} from './return-terms.js';

// The dialog a tenant whose subscription ended comes back through
// (`SC-CANC-034`): a plan and a rhythm from today's catalogue, and before the
// confirmation what the server says it would come back on — one period's
// price, from which day, how it can be cancelled, the deletion it lifts, and
// whether the tenant is open again at once —, or why it cannot. Whatever
// stands in the way is listed and keeps the confirmation locked: a plan the
// tenant's use does not fit, a payment method still to be entered, which a
// user holding the billing permission enters here and anybody else is told
// who can. The confirmation sends the version and the deletion day the
// preview showed; refused, the dialog says why and shows the return as it
// stands now — the preview the refusal carries, or the server's answer when
// asked again.
//
// It states and asks; whether it is offered is the tenant's state's to say
// (`mayReturn`), and the page that opens it reads that state.

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        http?: HttpClient;
        /** The prefix the billing routes sit under. Default `/billing`. */
        apiPrefix?: string;
        /** A day, as the application writes days. */
        formatDate: (iso: string) => string;
        /** A net amount in the installation's currency, as the application writes amounts. */
        formatCurrency: (amount: number) => string;
        /** The plans on sale, where the page has read them already. Default: read when it opens. */
        plans?: CatalogPlan[];
        /** A quota's label. Default: its key. */
        quotaLabel?: (key: string) => string;
        /** A quota's value. Default: unlimited as ∞, storage in GB, a count in the reader's locale. */
        formatQuotaValue?: (key: string, value: number) => string;
        /** Whether this user holds the billing permission, and so can enter a payment method here. */
        holdsBillingPermission?: boolean;
        /** Whether an unpaid invoice holds the tenant too, which keeps it read-only once it is back. */
        unpaidStays?: boolean;
    }>(),
    {
        http: undefined,
        apiPrefix: undefined,
        plans: undefined,
        quotaLabel: undefined,
        formatQuotaValue: undefined,
        holdsBillingPermission: false,
        unpaidStays: false,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', open: boolean): void;
    (e: 'returned', returned: SubscriptionReturnedShape): void;
}>();

const i18n = useTenantI18n();
const { intlLocale } = useSuperAdminI18n();
const returns = useTenantReturn({ http: props.http, apiPrefix: props.apiPrefix });
const catalog = useTenantBillingCatalog({
    http: props.http,
    apiPrefix: props.apiPrefix,
    autoLoad: false,
});

const plan = ref<string | null>(null);
const cycle = ref<BillingCycleStr>('MONTHLY');
const preview = ref<SubscriptionReturnPreviewShape | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const submitBlockers = ref<PlanChangePreviewIssueShape[]>([]);

const plans = computed(() => props.plans ?? catalog.plans.value ?? []);
const quotaKeys = computed(() => quotaKeysOf(plans.value));
const terms = computed(() =>
    preview.value !== null && preview.value.refusal === null ? preview.value : null,
);
const refusedSentence = computed(() =>
    preview.value !== null && preview.value.refusal !== null
        ? returnRefusalSentence(preview.value, i18n.value, props.formatDate)
        : null,
);
const lines = computed(() => {
    const shown = terms.value;
    if (!shown) return null;
    const chosen = plans.value.find((entry) => entry.id === shown.plan);
    return returnTermsLines(
        shown,
        catalogueNetOf(chosen, shown.billingCycle),
        props.unpaidStays,
        i18n.value,
        {
            formatDate: props.formatDate,
            formatCurrency: props.formatCurrency,
            intlLocale: intlLocale.value,
        },
    );
});
const paymentMethodFirst = computed(() => paymentMethodFirstSentence(i18n.value));
const confirmable = computed(
    () => !submitting.value && !previewLoading.value && mayConfirmReturn(terms.value),
);

const cycleI18n = computed(() => ({
    ariaLabel: `${i18n.value.cycleMonthly} / ${i18n.value.cycleYearly}`,
    monthly: i18n.value.cycleMonthly,
    yearly: i18n.value.cycleYearly,
}));
const gridI18n = computed(() => ({
    popular: i18n.value.wizardBadgePopular,
    current: i18n.value.wizardBadgeCurrent,
    perMonth: i18n.value.wizardPriceUnitMonthly,
    perYear: i18n.value.wizardPriceUnitYearly,
    priceOnRequest: i18n.value.wizardPriceOnRequest,
    notSoldInCycle: i18n.value.wizardNotSoldInCycle,
}));

function quotaLabelOf(key: string): string {
    return props.quotaLabel?.(key) ?? key;
}

function quotaValue(key: string, value: number): string {
    return props.formatQuotaValue?.(key, value) ?? defaultQuotaValue(key, value, intlLocale.value);
}

// Opened afresh each time: what the last opening chose, was shown and was
// refused belongs to a state that may have moved since.
watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        plan.value = null;
        cycle.value = 'MONTHLY';
        preview.value = null;
        previewError.value = null;
        submitError.value = null;
        submitBlockers.value = [];
        if (props.plans === undefined && catalog.plans.value === null) void catalog.load();
    },
    { immediate: true },
);

function choose(nextPlan: string | null, nextCycle: BillingCycleStr): void {
    plan.value = nextPlan;
    cycle.value = nextCycle;
    submitError.value = null;
    submitBlockers.value = [];
    void ask();
}

// Which question is outstanding: a rhythm or a plan chosen again while an
// answer is on its way asks again, and only the answer to the latest question
// is shown — an earlier one arriving last would state terms the reader has
// since left.
let latestQuestion = 0;

/** Asks what the tenant would come back on for the plan and rhythm chosen. */
async function ask(): Promise<void> {
    const chosen = plan.value;
    if (chosen === null) return;
    const question = (latestQuestion += 1);
    preview.value = null;
    previewError.value = null;
    previewLoading.value = true;
    try {
        const answered = await returns.preview({ plan: chosen, billingCycle: cycle.value });
        if (question === latestQuestion) preview.value = answered;
    } catch (err) {
        if (question !== latestQuestion) return;
        previewError.value = refusalMessage(err, i18n.value.issueMessages, props.formatDate);
    } finally {
        if (question === latestQuestion) previewLoading.value = false;
    }
}

async function confirm(): Promise<void> {
    const shown = terms.value;
    if (!shown || !confirmable.value) return;
    submitting.value = true;
    submitError.value = null;
    submitBlockers.value = [];
    try {
        const returned = await returns.takeOut({
            plan: shown.plan,
            billingCycle: shown.billingCycle,
            planVersionId: shown.planVersionId,
            expectedDeletesOn: shown.deletesOn,
        });
        emit('returned', returned);
        emit('update:modelValue', false);
    } catch (err) {
        const refused = returnRefused(err, i18n.value, props.formatDate);
        submitError.value = refused.sentence;
        submitBlockers.value = refused.blockers;
        if (refused.standing) preview.value = refused.standing;
        else await ask();
    } finally {
        submitting.value = false;
    }
}

function close(): void {
    if (submitting.value) return;
    emit('update:modelValue', false);
}
</script>

<style scoped>
.sp-return__intro,
.sp-return__note,
.sp-return__line {
    margin: 0 0 var(--sa-space-3);
}
.sp-return__note {
    color: var(--sa-color-fg-muted);
}
.sp-return__cycle {
    margin-bottom: var(--sa-space-4);
}
.sp-return__terms {
    margin-top: var(--sa-space-5);
    padding-top: var(--sa-space-4);
    border-top: 1px solid var(--sa-color-border);
}
.sp-return__price {
    margin: 0 0 var(--sa-space-3);
    font-size: var(--sa-text-lg);
    font-weight: var(--sa-weight-semibold);
    color: var(--sa-color-fg-heading);
}
.sp-return__heading {
    margin: 0 0 var(--sa-space-2);
    font-weight: var(--sa-weight-semibold);
}
.sp-return__blockers,
.sp-return__payment {
    margin-top: var(--sa-space-4);
}
.sp-return__error {
    margin: var(--sa-space-3) 0 0;
    color: var(--sa-color-negative-fg);
}
</style>
