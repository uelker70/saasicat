<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.join.title"
        :subtitle="msg.join.subtitle"
        :submit-label="msg.join.submit"
        :submit-disabled="!input"
        :submit="onSubmit"
        size="lg"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <AdminField :label="msg.join.searchLabel" :hint="msg.join.searchHint">
            <q-input
                v-model="query"
                outlined
                dense
                debounce="300"
                :placeholder="msg.join.searchPlaceholder"
                @update:model-value="search"
            />
        </AdminField>
        <AdminErrorBanner :error="candidatesError" :title="msg.join.candidatesFailed" />
        <ul v-if="searched" class="sa-subscriber-join__candidates">
            <li v-if="candidates.length === 0" class="sa-subscriber-join__muted">
                {{ msg.join.noCandidates }}
            </li>
            <li v-for="row in candidates" :key="row.id">
                <q-btn
                    flat
                    no-caps
                    align="left"
                    :outline="row.id === chosenId"
                    :label="candidateLabel(row)"
                    :aria-pressed="row.id === chosenId"
                    @click="choose(row.id)"
                />
            </li>
        </ul>

        <AdminErrorBanner :error="previewError" :title="msg.join.previewFailed" />
        <template v-if="preview">
            <div class="sa-subscriber-join__sides">
                <section
                    v-for="side in sides"
                    :key="side.title"
                    class="sa-subscriber-join__side"
                    :aria-label="side.title"
                >
                    <h3 class="sa-subscriber-join__heading">{{ side.title }}</h3>
                    <p class="sa-subscriber-join__holder">{{ side.holder }}</p>
                    <p class="sa-subscriber-join__muted">{{ side.address }}</p>
                    <p v-if="side.vatId" class="sa-subscriber-join__muted">{{ side.vatId }}</p>
                    <p
                        v-for="tenant in side.tenants"
                        :key="tenant"
                        class="sa-subscriber-join__muted"
                    >
                        {{ tenant }}
                    </p>
                </section>
            </div>

            <section class="sa-subscriber-join__part" :aria-label="msg.join.moving">
                <h3 class="sa-subscriber-join__heading">{{ msg.join.moving }}</h3>
                <dl class="sa-subscriber-join__counts">
                    <template v-for="each in moving" :key="each.table">
                        <dt>{{ msg.join.moved[each.table] }}</dt>
                        <dd>{{ each.count }}</dd>
                    </template>
                </dl>
            </section>

            <section class="sa-subscriber-join__part" :aria-label="msg.join.changes">
                <h3 class="sa-subscriber-join__heading">{{ msg.join.changes }}</h3>
                <p v-if="changes.length === 0" class="sa-subscriber-join__muted">
                    {{ msg.join.noChanges }}
                </p>
                <ul v-else class="sa-subscriber-join__changes">
                    <li v-for="change in changes" :key="change">{{ change }}</li>
                </ul>
                <p>{{ msg.join.vatIdCheck[preview.vatIdCheck] }}</p>
                <p v-if="preview.paymentMethodsOutOfUse > 0">
                    {{ msg.join.paymentMethodOutOfUse }}
                </p>
            </section>

            <AdminField :label="msg.subscriber.reason" :hint="msg.subscriber.reasonHint" required>
                <q-input
                    v-model="reason"
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    counter
                    :maxlength="REASON_MAX_LENGTH"
                />
            </AdminField>
            <q-checkbox v-model="sameEntity" :label="msg.join.sameEntity" />
        </template>
    </AdminFormDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
    AdminSubscriberJoinPreview,
    AdminSubscriberJoinSide,
    AdminSubscriberRow,
} from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import type { SubscriberJoin } from '../../vue/use-subscriber-join.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import { REASON_MAX_LENGTH } from './subscriber-corrections.js';
import {
    addressLineOf,
    joinChangesOf,
    joinInputOf,
    joinMovingOf,
    type JoinChange,
} from './subscriber-join.js';

// Joining the subscriber on screen — the one with the live tenant — into the
// earlier subscriber of the same legal entity (`SC-ADM-027`). The operator
// finds the earlier one among those without a live tenant, sees both side by
// side with what moves and what changes, gives a reason and declares both one
// legal entity; nothing can be sent before all of that, and the join is held to
// the preview shown.

const props = defineProps<{
    modelValue: boolean;
    join: SubscriberJoin;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', open: boolean): void }>();

const msg = useSaMessages('subscribers');

const query = ref('');
const searched = ref(false);
const candidates = ref<AdminSubscriberRow[]>([]);
const candidatesError = ref<unknown>(null);
const chosenId = ref<string | null>(null);
const preview = ref<AdminSubscriberJoinPreview | null>(null);
const previewError = ref<unknown>(null);
const reason = ref('');
const sameEntity = ref(false);

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        query.value = '';
        searched.value = false;
        candidates.value = [];
        candidatesError.value = null;
        chosenId.value = null;
        preview.value = null;
        previewError.value = null;
        reason.value = '';
        sameEntity.value = false;
    },
    { immediate: true },
);

const candidateLabel = (row: AdminSubscriberRow): string =>
    formatMessage(msg.value.join.candidate, {
        customerNumber: row.customerNumber,
        legalName: row.legalName,
    });

async function search(): Promise<void> {
    candidatesError.value = null;
    try {
        candidates.value = await props.join.candidates(query.value.trim());
        searched.value = true;
    } catch (error) {
        candidatesError.value = error;
    }
}

async function choose(intoSubscriberId: string): Promise<void> {
    chosenId.value = intoSubscriberId;
    preview.value = null;
    previewError.value = null;
    sameEntity.value = false;
    try {
        preview.value = await props.join.preview(intoSubscriberId);
    } catch (error) {
        previewError.value = error;
    }
}

const sideOf = (title: string, side: AdminSubscriberJoinSide) => ({
    title,
    holder: formatMessage(msg.value.subscriber.holder, {
        customerNumber: side.subscriber.customerNumber,
        legalName: side.subscriber.legalName,
    }),
    address: addressLineOf(side.subscriber),
    vatId: side.subscriber.vatId,
    tenants: side.tenants.map((tenant) =>
        formatMessage(
            tenant.unlinkedAt === null ? msg.value.join.tenantLive : msg.value.join.tenantClosed,
            {
                name: tenant.name ?? tenant.slug ?? tenant.tenantId,
            },
        ),
    ),
});

const sides = computed(() =>
    preview.value
        ? [
              sideOf(msg.value.join.sideFrom, preview.value.from),
              sideOf(msg.value.join.sideInto, preview.value.into),
          ]
        : [],
);

const moving = computed(() => (preview.value ? joinMovingOf(preview.value) : []));

const shown = (value: string | null) => value ?? msg.value.subscriber.notStated;
const shownBusiness = (value: boolean | null) =>
    value === null
        ? msg.value.subscriber.notStated
        : value
          ? msg.value.subscriber.businessTrue
          : msg.value.subscriber.businessFalse;

function describe(change: JoinChange): string {
    const m = msg.value;
    if (change.kind === 'address') {
        return formatMessage(m.join.change, {
            field: m.subscriber.address,
            previous: change.previous || m.subscriber.notStated,
            next: change.next,
        });
    }
    if (change.kind === 'invoiceEmail') {
        return formatMessage(m.join.change, {
            field: m.subscriber.invoiceEmail,
            previous: shown(change.previous),
            next: shown(change.next),
        });
    }
    if (change.kind === 'business') {
        return formatMessage(m.join.change, {
            field: m.subscriber.business,
            previous: shownBusiness(change.previous),
            next: shownBusiness(change.next),
        });
    }
    return formatMessage(m.join.correctedAs, {
        field: m.subscriber[change.field],
        previous: shown(change.previous),
        next: shown(change.next),
    });
}

const changes = computed(() => (preview.value ? joinChangesOf(preview.value).map(describe) : []));

const input = computed(() =>
    joinInputOf(preview.value, { reason: reason.value, sameEntity: sameEntity.value }),
);

function onSubmit(): Promise<unknown> {
    // Disabled until there is one; the guard keeps the type honest.
    return input.value ? props.join.join(input.value) : Promise.resolve(null);
}
</script>

<style scoped>
.sa-subscriber-join__candidates,
.sa-subscriber-join__changes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sa-space-1);
}
.sa-subscriber-join__sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--sa-space-3);
}
.sa-subscriber-join__side,
.sa-subscriber-join__part {
    display: grid;
    gap: var(--sa-space-1);
}
.sa-subscriber-join__heading {
    margin: 0;
    font-size: var(--sa-text-sm);
    font-weight: var(--sa-weight-medium);
}
.sa-subscriber-join__holder {
    margin: 0;
    font-weight: var(--sa-weight-medium);
}
.sa-subscriber-join__side p,
.sa-subscriber-join__part p {
    margin: 0;
}
.sa-subscriber-join__muted {
    color: var(--sa-color-fg-muted);
}
.sa-subscriber-join__counts {
    display: grid;
    grid-template-columns: auto auto;
    justify-content: start;
    column-gap: var(--sa-space-3);
    margin: 0;
}
.sa-subscriber-join__counts dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
}
</style>
