<template>
    <AdminSection :title="msg.subscriber.title" :subtitle="holderLine" class="q-mb-md">
        <template v-if="corrections?.available.value && standing?.subscriber" #actions>
            <q-btn
                flat
                no-caps
                icon="edit"
                :label="msg.subscriber.correct"
                :disable="pending"
                @click="identityOpen = true"
            />
            <q-btn
                flat
                no-caps
                icon="business"
                :label="msg.subscriber.changeBusiness"
                :disable="pending"
                @click="businessOpen = true"
            />
            <q-btn
                v-if="corrections.canCheckVatId.value && standing.subscriber.vatId"
                flat
                no-caps
                icon="verified"
                :label="msg.subscriber.checkVatId"
                :disable="pending"
                :loading="checking"
                @click="onCheck"
            />
        </template>
        <AdminErrorBanner :error="error" :title="msg.subscriber.loadFailed" :retry="retry" />
        <p v-if="!error && pending && !standing" class="sa-tenant-subscriber__note">
            {{ common.loading }}
        </p>
        <template v-else-if="!error && standing">
            <p v-if="!standing.subscriber" class="sa-tenant-subscriber__note">
                {{ msg.subscriber.none }}
            </p>
            <template v-else>
                <AdminBanner
                    v-if="reasons.length > 0"
                    tone="warning"
                    :title="msg.subscriber.heldBack"
                    class="q-mb-md"
                >
                    <ul class="sa-tenant-subscriber__reasons">
                        <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
                    </ul>
                </AdminBanner>
                <div class="sa-kv-grid">
                    <KvBlock
                        v-for="row in rows"
                        :key="row.label"
                        :label="row.label"
                        :value="row.value"
                    />
                </div>
                <template v-if="corrections?.available.value">
                    <SubscriberIdentityDialog
                        v-model="identityOpen"
                        :subscriber="standing.subscriber"
                        :submit="corrections.correctIdentity"
                    />
                    <SubscriberBusinessStatusDialog
                        v-model="businessOpen"
                        :business="standing.subscriber.business"
                        :submit="corrections.changeBusinessStatus"
                    />
                </template>
            </template>
        </template>
    </AdminSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdminTenantSubscriber } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import KvBlock from '../../ui/data/KvBlock.vue';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { SubscriberCorrections } from '../../vue/use-subscriber-corrections.js';
import { heldBackReasons } from '../tenants/held-back.js';
import SubscriberBusinessStatusDialog from './SubscriberBusinessStatusDialog.vue';
import SubscriberIdentityDialog from './SubscriberIdentityDialog.vue';

// Whom the tenant's contracts are concluded with: the legal name, the address
// an invoice names, and what a tax adapter decides from. Where a tax adapter
// decides and something holds the next contract back, a warning names it
// first. Where the platform serves the corrections, the section offers them:
// the legal identity and the business status, each in its own dialog, and a
// check of the VAT number held where an adapter names a service.
const props = defineProps<{
    standing: AdminTenantSubscriber | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    corrections?: SubscriberCorrections;
}>();

const identityOpen = ref(false);
const businessOpen = ref(false);

// A dialog belongs to the subscriber it was opened for. Once another one is
// shown — or none, while the next tenant's is read — it closes rather than
// open again with its form for whoever comes next.
watch(
    () => props.standing?.subscriber?.id,
    () => {
        identityOpen.value = false;
        businessOpen.value = false;
    },
);
const checking = ref(false);

async function onCheck(): Promise<void> {
    checking.value = true;
    try {
        await props.corrections?.checkVatId();
    } finally {
        checking.value = false;
    }
}

const msg = useSaMessages('tenants');
const common = useSaMessages('common');

const holderLine = computed(() => {
    const subscriber = props.standing?.subscriber;
    if (!subscriber) return undefined;
    return formatMessage(msg.value.subscriber.holder, {
        customerNumber: subscriber.customerNumber,
        legalName: subscriber.legalName,
    });
});

const reasons = computed(() => {
    const readiness = props.standing?.readiness;
    return readiness ? heldBackReasons(readiness, msg.value.subscriber) : [];
});

/** The parts of the address that are given, on one line; `null` where none is. */
function addressLine(subscriber: NonNullable<AdminTenantSubscriber['subscriber']>): string | null {
    const place = [subscriber.postalCode, subscriber.city].filter(Boolean).join(' ');
    const parts = [subscriber.addressLine1, subscriber.addressLine2, place].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
}

const rows = computed(() => {
    const subscriber = props.standing?.subscriber;
    if (!subscriber) return [];
    const m = msg.value.subscriber;
    const stated = (value: string | null): string => value ?? m.notStated;
    const vatId = subscriber.vatId
        ? formatMessage(subscriber.vatIdValidated ? m.vatIdValidated : m.vatIdNotValidated, {
              vatId: subscriber.vatId,
          })
        : null;
    const business =
        subscriber.business === null
            ? null
            : subscriber.business
              ? m.businessTrue
              : m.businessFalse;
    return [
        { label: m.customerNumber, value: subscriber.customerNumber },
        { label: m.legalName, value: subscriber.legalName },
        { label: m.address, value: stated(addressLine(subscriber)) },
        { label: m.country, value: stated(subscriber.country) },
        { label: m.business, value: stated(business) },
        { label: m.vatId, value: stated(vatId) },
        { label: m.taxNumber, value: stated(subscriber.taxNumber) },
        { label: m.origin, value: subscriber.migrated ? m.migrated : m.entered },
    ];
});
</script>

<style scoped>
.sa-tenant-subscriber__note {
    color: var(--sa-color-fg-muted);
    margin: 0;
}
.sa-tenant-subscriber__reasons {
    margin: 0;
    padding-left: var(--sa-space-4);
}
</style>
