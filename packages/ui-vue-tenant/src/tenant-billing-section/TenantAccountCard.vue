<template>
    <TenantCardSection v-if="account.available.value" class="sp-account">
        <section :aria-labelledby="headingId">
            <h3 :id="headingId" class="sp-account__title">{{ i18n.accountTitle }}</h3>
            <p v-if="account.error.value" class="sp-account__error" role="alert">
                {{ i18n.accountLoadFailed }}
            </p>
            <p v-else-if="lines.length === 0" class="sp-account__line">
                {{ i18n.accountNothingOpen }}
            </p>
            <ul v-else class="sp-account__lines">
                <li v-for="line in lines" :key="line.key" class="sp-account__line">
                    {{ line.text }}
                </li>
            </ul>
            <template v-if="owes">
                <div class="sp-account__actions">
                    <TenantButton :loading="account.paying.value" @click="account.payNow()">
                        {{ i18n.accountPayNow }}
                    </TenantButton>
                </div>
                <p class="sp-account__hint">{{ hint }}</p>
            </template>
            <p v-if="account.payError.value" class="sp-account__error" role="alert">
                {{ i18n.accountPayFailed }}
            </p>
            <p v-else-if="startedMessage" class="sp-account__started" role="status">
                {{ startedMessage }}
            </p>
        </section>
    </TenantCardSection>
</template>

<script setup lang="ts">
import { useTenantAccount, type HttpClient } from '@saasicat/ui-vue';
import { computed, useId, watch } from 'vue';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantCardSection from '../ui/TenantCardSection.vue';
import '../ui/tenant-ui.css';
import { accountLinesOf } from './account-lines.js';
import { payNowHint, paymentStartedMessage } from './payment-started.js';

// TenantAccountCard — what the tenant's subscriber owes and is owed, at the
// top of its billing section (`SC-PRIC-049`): what is open and of that
// overdue, and beside it the credit to be refunded, and where something is open
// a way to pay it now, with when the account opens again by card and by direct
// debit — the day a direct debit announced now is collected — said before it is
// pressed (`SC-PRIC-100`). The history is the invoice
// list beneath it. Behind the billing permission like the rest of the section,
// so it does not render for anyone else — nor before the first answer, which is
// what says whether it is for this user; a reload keeps the lines it shows.

const props = defineProps<{
    http?: HttpClient;
    apiPrefix?: string;
    /** An amount, with the ISO 4217 currency of the balance it is of. */
    formatCurrency: (amount: number, currency: string) => string;
    /** A day, as the application writes days. */
    formatDate: (iso: string) => string;
}>();

const emit = defineEmits<{
    /** Whether this part is shown to the user at all. */
    availability: [shown: boolean];
}>();

const i18n = useTenantI18n();
const headingId = useId();
const account = useTenantAccount({ http: props.http, apiPrefix: props.apiPrefix });
watch(account.available, (shown) => emit('availability', shown), { immediate: true });

const lines = computed(() =>
    accountLinesOf(account.balances.value, i18n.value, props.formatCurrency),
);
const owes = computed(() => account.balances.value.some((balance) => balance.owed > 0));
const hint = computed(() =>
    payNowHint(i18n.value, props.formatDate, account.directDebitCollectedOn.value),
);
const startedMessage = computed(() =>
    account.started.value ? paymentStartedMessage(account.started.value, i18n.value) : null,
);
</script>

<style scoped>
.sp-account__title {
    font-size: var(--sa-text-md);
    font-weight: 600;
    line-height: var(--sa-leading-md);
    margin: 0 0 var(--sa-space-2);
}
.sp-account__error {
    margin: 0;
    color: var(--sa-color-negative-fg);
}
.sp-account__lines {
    margin: 0;
    padding: 0;
    list-style: none;
}
.sp-account__line {
    margin: 0;
    font-size: var(--sa-text-md);
}
.sp-account__actions {
    margin-top: var(--sa-space-4);
}
.sp-account__started {
    margin: var(--sa-space-2) 0 0;
    font-size: var(--sa-text-md);
}
.sp-account__hint {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-md);
}
</style>
