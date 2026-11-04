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
        </section>
    </TenantCardSection>
</template>

<script setup lang="ts">
import { useTenantAccount, type HttpClient } from '@saasicat/ui-vue';
import { computed, useId, watch } from 'vue';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantCardSection from '../ui/TenantCardSection.vue';
import '../ui/tenant-ui.css';
import { accountLinesOf } from './account-lines.js';

// TenantAccountCard — what the tenant's subscriber owes and is owed, at the
// top of its billing section (`SC-PRIC-049`): what is open and of that
// overdue, and beside it the credit to be refunded. The history is the invoice
// list beneath it. Behind the billing permission like the rest of the section,
// so it does not render for anyone else — nor before the first answer, which is
// what says whether it is for this user; a reload keeps the lines it shows.

const props = defineProps<{
    http?: HttpClient;
    apiPrefix?: string;
    formatCurrency: (n: number) => string;
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
</style>
