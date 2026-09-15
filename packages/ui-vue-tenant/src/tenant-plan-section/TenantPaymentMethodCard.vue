<template>
    <hr v-if="method.available.value" class="sp-divider" />
    <TenantCardSection v-if="method.available.value" class="sp-payment-method">
        <section :aria-labelledby="headingId">
            <h3 :id="headingId" class="sp-payment-method__title">{{ i18n.paymentMethodTitle }}</h3>

            <p v-if="method.loading.value && !current" class="sp-plan-section__sub">
                {{ i18n.loading }}
            </p>
            <p v-else-if="method.error.value" class="sp-payment-method__error" role="alert">
                {{ i18n.paymentMethodLoadFailed }}
            </p>
            <template v-else-if="current">
                <p class="sp-payment-method__summary">{{ summary }}</p>
                <p v-if="current.mandateReference" class="sp-plan-section__sub">
                    {{ mandate }}
                </p>
            </template>
            <p v-else class="sp-plan-section__sub">{{ i18n.paymentMethodNone }}</p>

            <p v-if="changeFailed" class="sp-payment-method__error" role="alert">
                {{ i18n.paymentMethodChangeFailed }}
            </p>
            <div class="sp-payment-method__actions">
                <TenantButton
                    variant="outline"
                    tone="neutral"
                    :loading="starting"
                    :disabled="Boolean(method.error.value)"
                    @click="onChange"
                >
                    {{ current ? i18n.paymentMethodChange : i18n.paymentMethodAdd }}
                </TenantButton>
            </div>
            <p class="sp-plan-section__sub">{{ i18n.paymentMethodGatewayNote }}</p>
        </section>
    </TenantCardSection>
</template>

<script setup lang="ts">
import { useTenantPaymentMethod, type HttpClient } from '@saasicat/ui-vue';
import { computed, ref, useId } from 'vue';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantCardSection from '../ui/TenantCardSection.vue';
import { messageParts } from '../message-parts.js';
import { paymentMethodSummary } from './payment-method-summary.js';
import '../ui/tenant-ui.css';

// What the tenant's subscriber pays with. Nothing is shown to a user without
// the billing permission — the server answers them 403, and the composable
// reads that as "not for this user" — and a change happens only in the payment
// provider's form, which this card opens and never replaces.

const props = defineProps<{
    http?: HttpClient;
    apiPrefix?: string;
    /** Where the provider's form sends the person back. Default: this page. */
    returnUrl?: string;
    /** How the person is sent to the provider's form. Default: `window.location.assign`. */
    navigate?: (url: string) => void;
}>();

const i18n = useTenantI18n();
const method = useTenantPaymentMethod({ http: props.http, apiPrefix: props.apiPrefix });
const headingId = `sp-payment-method-${useId()}`;

const current = computed(() => method.paymentMethod.value);
const summary = computed(() =>
    current.value ? paymentMethodSummary(current.value, i18n.value) : '',
);
const mandate = computed(() =>
    messageParts(i18n.value.paymentMethodMandate, {
        reference: current.value?.mandateReference ?? '',
    })
        .map((part) => part.text)
        .join(''),
);

const starting = ref(false);
const changeFailed = ref(false);

async function onChange(): Promise<void> {
    starting.value = true;
    changeFailed.value = false;
    const returnTo = props.returnUrl ?? window.location.href;
    try {
        const url = await method.startChange({ successUrl: returnTo, cancelUrl: returnTo });
        (props.navigate ?? ((target: string) => window.location.assign(target)))(url);
    } catch {
        // Said on the card rather than thrown on: a click handler's rejection
        // reaches no caller, and the person needs to know the form did not open.
        changeFailed.value = true;
    } finally {
        starting.value = false;
    }
}
</script>

<style scoped>
.sp-payment-method__title {
    font-size: var(--sa-text-md);
    font-weight: 600;
    line-height: var(--sa-leading-md);
    margin: 0 0 var(--sa-space-3);
}
.sp-payment-method__summary {
    margin: 0;
}
.sp-payment-method__error {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-negative-fg);
}
.sp-payment-method__actions {
    margin-top: var(--sa-space-4);
}
</style>
