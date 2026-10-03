<template>
    <AdminDialog
        :model-value="flow.target.value !== null"
        :title="formatMessage(texts.title, { version: flow.target.value?.version ?? '' })"
        size="md"
        persistent
        @update:model-value="(open: boolean) => !open && flow.close()"
    >
        <div v-if="flow.result.value">
            <AdminBanner tone="positive">
                {{
                    formatMessage(texts.done, {
                        told: flow.result.value.told,
                        failed: flow.result.value.failed,
                    })
                }}
            </AdminBanner>
        </div>
        <div v-else class="sa-retire">
            <p class="text-body2">{{ intro }}</p>
            <slot />
            <q-linear-progress v-if="flow.loading.value" indeterminate class="q-mt-sm" />

            <AdminBanner v-if="noVersionOnSale" tone="warning" class="q-mt-md">
                {{ noVersionOnSale }}
            </AdminBanner>

            <template v-if="preview">
                <section class="q-mt-md" :aria-label="replacement">
                    <div class="text-subtitle2">{{ replacement }}</div>
                    <dl class="sa-retire__prices">
                        <template v-for="row in priceRows" :key="row.label">
                            <dt>{{ row.label }}</dt>
                            <dd>{{ row.text }}</dd>
                        </template>
                    </dl>
                    <p v-if="texts.pricesNote" class="text-caption">{{ texts.pricesNote }}</p>
                    <p v-if="otherChanges > 0" class="text-caption">
                        {{ formatMessage(texts.otherChanges, { count: otherChanges }) }}
                    </p>
                </section>

                <section class="q-mt-md" :aria-label="reachedTitle">
                    <div class="text-subtitle2">{{ reachedTitle }}</div>
                    <ul class="sa-retire__list">
                        <li v-for="date in dates" :key="date.effectiveAt">
                            {{
                                formatMessage(texts.dateRow, {
                                    count: date.count,
                                    date: formatDate(date.effectiveAt),
                                    lastDay: formatDate(date.lastDayToCancel),
                                })
                            }}
                        </li>
                    </ul>
                </section>

                <section
                    v-if="skipLines.length > 0"
                    class="q-mt-md"
                    :aria-label="texts.skippedTitle"
                >
                    <div class="text-subtitle2">{{ texts.skippedTitle }}</div>
                    <ul class="sa-retire__list">
                        <li v-for="line in skipLines" :key="line.reason">{{ line.text }}</li>
                    </ul>
                </section>

                <AdminBanner
                    v-for="blocker in preview.blockers"
                    :key="blocker.code"
                    tone="negative"
                    class="q-mt-md"
                >
                    {{ blockerText(blocker, texts.blockers) }}
                </AdminBanner>
            </template>
        </div>

        <template #footer>
            <AdminBanner v-if="flow.error.value" tone="negative">{{
                flow.error.value
            }}</AdminBanner>
            <div class="sa-dialog__actions">
                <q-btn
                    flat
                    :label="flow.result.value ? common.close : common.cancel"
                    @click="flow.close()"
                />
                <q-btn
                    v-if="!flow.result.value"
                    color="primary"
                    :label="texts.announce"
                    :loading="flow.announcing.value"
                    :disable="!canAnnounce"
                    @click="flow.announce()"
                />
            </div>
        </template>
    </AdminDialog>
</template>

<script setup lang="ts">
// Retiring a version for what runs on it — a plan version's subscriptions or
// an add-on version's bookings: the replacement and what changes in its price,
// whom it reaches and when, whom it misses, and what refuses it. The flow is
// the area's composable and the words are the area's catalogue; this draws
// both the same way. What only one of them asks — the plan to continue on — is
// the default slot.

import { computed } from 'vue';
import type { RetirementBlocker, VersionChange } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatDay, formatMessage } from '../../client/i18n/format.js';
import { blockerText, retirementDates } from '../../client/version-retirement.js';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminDialog from '../../ui/overlay/AdminDialog.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

interface Readable<T> {
    readonly value: T;
}

interface PricedSide {
    readonly monthlyNet: number | null;
    readonly yearlyNet: number | null;
}

/** What the dialog reads off a preview, whichever kind of version it retires. */
interface RetirePreviewView {
    readonly retired: PricedSide;
    readonly replacement: PricedSide;
    readonly changes: readonly Pick<VersionChange, 'field'>[];
    readonly reached: readonly { readonly effectiveAt: string; readonly lastDayToCancel: string }[];
    readonly blockers: readonly RetirementBlocker[];
}

/** The part of a retirement flow the dialog draws and drives. */
interface RetireFlowView {
    readonly target: Readable<{ readonly version: number } | null>;
    readonly preview: Readable<RetirePreviewView | null>;
    readonly loading: Readable<boolean>;
    readonly announcing: Readable<boolean>;
    readonly error: Readable<string | null>;
    readonly result: Readable<{ readonly told: number; readonly failed: number } | null>;
    close: () => void;
    announce: () => Promise<void>;
}

/** The words the dialog says, from the area's `retireDialog` catalogue. */
interface RetireDialogTexts {
    readonly title: string;
    readonly done: string;
    readonly priceChange: string;
    readonly notSold: string;
    /** Said under the prices where the area has something to add about them. */
    readonly pricesNote?: string;
    readonly otherChanges: string;
    readonly reachedTitle: string;
    readonly dateRow: string;
    readonly skippedTitle: string;
    readonly blockers: Readonly<Record<string, string>>;
    readonly announce: string;
}

const props = defineProps<{
    flow: RetireFlowView;
    texts: RetireDialogTexts;
    /** What retiring this version does, in the area's words. */
    intro: string;
    /** Names the replacement, once the preview is read. */
    replacement: string;
    /** Says there is nothing to continue on; empty where there is. */
    noVersionOnSale: string;
    /**
     * Whom it misses, one line per reason. The area words them: the reasons
     * differ between what a plan retirement and an add-on retirement can skip.
     */
    skipLines: readonly { readonly reason: string; readonly text: string }[];
}>();

const common = useSaMessages('common');
const { locale, intlLocale } = useSuperAdminI18n();

const preview = computed(() => props.flow.preview.value);

function formatDate(iso: string): string {
    return formatDay(iso, intlLocale.value);
}

const priceRows = computed(() => {
    const shown = preview.value;
    if (!shown) return [];
    const price = (net: number | null) =>
        net === null ? props.texts.notSold : formatCurrency(net, locale.value);
    const row = (label: string, from: number | null, to: number | null) => ({
        label,
        text: formatMessage(props.texts.priceChange, { from: price(from), to: price(to) }),
    });
    return [
        row(common.value.monthly, shown.retired.monthlyNet, shown.replacement.monthlyNet),
        row(common.value.yearly, shown.retired.yearlyNet, shown.replacement.yearlyNet),
    ];
});
const otherChanges = computed(
    () =>
        preview.value?.changes.filter(
            (change) => change.field !== 'monthlyNet' && change.field !== 'yearlyNet',
        ).length ?? 0,
);
const reachedTitle = computed(() =>
    formatMessage(props.texts.reachedTitle, { count: preview.value?.reached.length ?? 0 }),
);
const dates = computed(() => (preview.value ? retirementDates(preview.value) : []));
const canAnnounce = computed(
    () =>
        !props.flow.loading.value && preview.value !== null && preview.value.blockers.length === 0,
);
</script>

<style scoped>
.sa-retire__prices {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--sa-space-1) var(--sa-space-3);
    margin: var(--sa-space-2) 0 0;
}

.sa-retire__prices dd {
    margin: 0;
}

.sa-retire__list {
    margin: var(--sa-space-2) 0 0;
    padding-left: var(--sa-space-4);
}
</style>
