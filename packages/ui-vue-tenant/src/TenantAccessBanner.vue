<template>
    <div
        v-if="held"
        class="sp-access-banner"
        :class="{ 'sp-access-banner--stopped': held.state !== 'read-only' }"
        role="status"
        :aria-labelledby="stateId"
    >
        <p :id="stateId" class="sp-access-banner__state">{{ stateSentence }}</p>
        <ul class="sp-access-banner__reasons">
            <li v-for="(line, index) in reasonLines" :key="index" class="sp-access-banner__reason">
                {{ line }}
            </li>
        </ul>
        <div v-if="payable || exportable" class="sp-access-banner__actions">
            <TenantButton v-if="payable" :loading="account.paying.value" @click="pay">
                {{ i18n.accountPayNow }}
            </TenantButton>
            <TenantButton
                v-if="exportable"
                :loading="tenantExport.downloading.value"
                @click="takeExport"
            >
                {{ i18n.accessExport }}
            </TenantButton>
        </div>
        <template v-if="payable">
            <p v-if="onlyUnpaid" class="sp-access-banner__hint">{{ hint }}</p>
            <p v-if="account.payError.value" class="sp-access-banner__error" role="alert">
                {{ i18n.accountPayFailed }}
            </p>
            <p v-else-if="startedMessage" class="sp-access-banner__hint">{{ startedMessage }}</p>
        </template>
        <p v-else-if="askBilling" class="sp-access-banner__hint">
            {{ i18n.accessAskBilling }}
        </p>
        <p v-if="exportFailure" class="sp-access-banner__error" role="alert">
            {{ exportFailure }}
        </p>
    </div>
</template>

<script setup lang="ts">
import {
    useTenantAccessState,
    useTenantAccount,
    useTenantExport,
    type HttpClient,
} from '@saasicat/ui-vue';
import { computed, ref, useId, watch } from 'vue';

import { payNowHint, paymentStartedMessage } from './tenant-billing-section/payment-started.js';
import {
    accessReasonLine,
    accessStateSentence,
    exportFailureSentence,
    heldBackView,
} from './tenant-access/access-lines.js';
import { useTenantI18n } from './tenant-i18n.js';
import TenantButton from './ui/TenantButton.vue';
import './ui/tenant-ui.css';

// TenantAccessBanner — why the tenant is held back, above the application for
// every one of its users (`SC-ADM-054`). It says the state in the words a
// refused request uses for it, and beneath it each reason from its day in the
// installation. Under an invoice unpaid on its due date, a user who holds the
// billing permission reads the invoice by its number and can pay it from here,
// told before pressing when the account opens again by card and by direct
// debit (`SC-PRIC-100`); anybody else is told who can pay it.
//
// The state is read on mount and again every minute, so a hold begun or lifted
// while the page is open shows without a reload.
//
// Paying is offered, and a user without the permission told who can pay, only
// while the tenant is read-only: a suspension and a deletion under way let no
// payment through, and paying would be refused.
//
// Once its subscription has ended, every user reads the last day the tenant
// can still read and the day its data is deleted on (`SC-CANC-033`), and its
// administrator can take the tenant's full export from here where the server
// says they may (`SC-PRIV-019`). A download that fails says why beneath and
// leaves the banner as it was.
// While the state is being read, where the tenant is open, and where it cannot
// be read, the banner shows nothing — a refused request still says why on its
// own, and a banner announcing that it failed would sit above every page.

const props = defineProps<{
    http?: HttpClient;
    /** The prefix the billing routes sit under. Default `/billing`. */
    apiPrefix?: string;
    /** A day, as the application writes days. */
    formatDate: (iso: string) => string;
}>();

const i18n = useTenantI18n();
const stateId = useId();
const access = useTenantAccessState({ http: props.http, apiPrefix: props.apiPrefix });
const account = useTenantAccount({
    http: props.http,
    apiPrefix: props.apiPrefix,
    autoLoad: false,
});
const tenantExport = useTenantExport({ http: props.http, apiPrefix: props.apiPrefix });
const exportFailure = ref<string | null>(null);

const held = computed(() => heldBackView(access.view.value));
const stateSentence = computed(() =>
    held.value ? accessStateSentence(held.value.state, i18n.value) : '',
);
const reasonLines = computed(() =>
    (held.value?.reasons ?? []).map((reason) =>
        accessReasonLine(reason, i18n.value, props.formatDate),
    ),
);
// An unpaid invoice can be paid now only while the tenant is read-only: a
// suspension and a deletion under way let no payment through. Both what is
// offered to a user who may pay and what anybody else is told follow from it.
const payableNow = computed(
    () =>
        held.value?.state === 'read-only' &&
        held.value.reasons.some((reason) => reason.kind === 'overdue'),
);
const payable = computed(() => payableNow.value && held.value?.mayPay === true);
const askBilling = computed(() => payableNow.value && held.value?.holdsBillingPermission === false);
// The server says it only to the tenant's administrator, and only where the
// export would be served.
const exportable = computed(() => held.value?.mayExport === true);
// Paying opens the account again only where nothing but unpaid invoices holds
// it back; an ended subscription keeps it read-only after the payment.
const onlyUnpaid = computed(
    () => held.value?.reasons.every((reason) => reason.kind === 'overdue') ?? false,
);

// The day a direct debit is collected on is the account's to say, read only
// where paying is offered.
watch(
    payable,
    (offered) => {
        if (offered) void account.reload();
    },
    { immediate: true },
);

const hint = computed(() =>
    payNowHint(i18n.value, props.formatDate, account.directDebitCollectedOn.value),
);
const startedMessage = computed(() =>
    account.started.value ? paymentStartedMessage(account.started.value, i18n.value) : null,
);

async function pay(): Promise<void> {
    await account.payNow();
    await access.reload();
}

async function takeExport(): Promise<void> {
    exportFailure.value = null;
    try {
        await tenantExport.download();
    } catch (err) {
        exportFailure.value = exportFailureSentence(err, i18n.value, i18n.value.accessExportFailed);
    }
}
</script>

<style scoped>
.sp-access-banner {
    padding: var(--sa-space-2) var(--sa-space-4);
    border-bottom: 1px solid var(--sa-color-warning-border);
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    font-size: var(--sa-text-sm);
}
.sp-access-banner--stopped {
    border-bottom-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
}
.sp-access-banner__state {
    margin: 0;
    font-weight: var(--sa-weight-semibold);
}
.sp-access-banner__reasons {
    margin: var(--sa-space-1) 0 0;
    padding: 0;
    list-style: none;
}
.sp-access-banner__reason,
.sp-access-banner__hint,
.sp-access-banner__error {
    margin: 0;
}
.sp-access-banner__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-2);
}
.sp-access-banner__hint,
.sp-access-banner__error {
    margin-top: var(--sa-space-1);
}
</style>
