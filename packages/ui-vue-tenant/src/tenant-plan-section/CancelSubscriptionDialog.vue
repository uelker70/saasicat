<template>
    <!--
        Cancellation confirmation. The date is stated BEFORE the click, not
        reported after it: with a notice period configured, a declaration four
        days late lands a whole period further out, and that is the sentence a
        customer disputes if they meet it in the receipt instead of in the
        question. Until when its data can still be read, and the day it is
        deleted on, are stated here for the same reason.
    -->
    <TenantDialog
        :model-value="modelValue"
        :title="i18n.cancelConfirmTitle"
        size="sm"
        @update:model-value="
            (open: boolean) => {
                if (!open) emit('update:modelValue', false);
            }
        "
    >
        <p v-if="error" class="sp-plan-section__warn">{{ error }}</p>
        <p v-if="cancellation?.afterNoticeDeadline" class="sp-plan-section__warn">
            {{
                i18n.cancelConfirmLate
                    .replace(
                        '{deadline}',
                        writeDay(formatDate, cancellation.noticeDeadlineDays?.until),
                    )
                    .replace('{date}', writeDay(formatDate, cancellation.effectiveDays?.until))
            }}
        </p>
        <p v-if="retirement">
            {{
                i18n.cancelConfirmRetirement
                    .replace('{version}', String(retirement.retired.version))
                    .replace('{date}', writeDay(formatDate, retirement.lastDayToCancel))
            }}
        </p>
        <p v-if="cancellation">
            {{
                i18n.cancelConfirmBody.replace(
                    '{date}',
                    writeDay(formatDate, cancellation.effectiveDays?.until),
                )
            }}
        </p>
        <p v-if="deletionText">{{ deletionText }}</p>

        <template #footer>
            <TenantButton :disabled="submitting" @click="emit('update:modelValue', false)">
                {{ i18n.bundlePreviewClose }}
            </TenantButton>
            <TenantButton variant="solid" tone="danger" :loading="submitting" @click="confirm">
                {{
                    cancellation
                        ? i18n.cancelConfirmAction.replace(
                              '{date}',
                              writeDay(formatDate, cancellation.effectiveDays?.until),
                          )
                        : i18n.cancelSubscriptionButton
                }}
            </TenantButton>
        </template>
    </TenantDialog>
</template>

<script setup lang="ts">
// The confirmation of a subscription's cancellation: what cancelling now
// would do, as the server projects it — the date it lands on, why it is that
// date, until when the tenant's data can still be read and the day it is
// deleted on — and
// the click that confirms exactly that.
//
// It states and reports; it does not cancel. The page owns the request, so the
// fresh projection read when it opens, the refusal and the reading after it
// stay where the subscription is loaded.

import type { CalendarDay } from '@saasicat/core';
import type { UsageSnapshotShape } from '@saasicat/ui-vue';
import { computed } from 'vue';

import { deletionSentence } from '../announced-deletion.js';
import { writeDay } from '../day-as-instant.js';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import '../ui/tenant-ui.css';

/** What the dialog showed, which the cancellation sends for the server to check. */
export interface CancellationShown {
    expectedEffectiveAt?: string;
    expectedDeletesOn?: CalendarDay;
}

const props = defineProps<{
    modelValue: boolean;
    /** What cancelling right now would do — the server's projection, not ours. */
    cancellation: UsageSnapshotShape['cancellation'] | null;
    /** The retirement of the version the subscription is on, while one is pending. */
    retirement: UsageSnapshotShape['retirement'];
    /** While the cancellation is being sent. */
    submitting: boolean;
    /** Why the last confirmation was refused; null while none was. */
    error: string | null;
    /** Handed noon of a day the server named, which it writes in the viewer's zone. */
    formatDate: (value: string | Date) => string;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', open: boolean): void;
    (e: 'confirm', shown: CancellationShown): void;
}>();

const i18n = useTenantI18n();

/** Until when the data can still be read after it, and the day it is deleted on; null where none is announced. */
const deletionText = computed(() =>
    deletionSentence(i18n.value.deletionAnnounced, props.cancellation?.deletion, props.formatDate),
);

function confirm(): void {
    // The date and the deletion day this dialog showed travel with the
    // request. If the server's answer has since moved, it refuses rather than
    // applying a date the customer never saw.
    emit('confirm', {
        expectedEffectiveAt: props.cancellation?.effectiveAt,
        expectedDeletesOn: props.cancellation?.deletion?.deletesOn,
    });
}
</script>
