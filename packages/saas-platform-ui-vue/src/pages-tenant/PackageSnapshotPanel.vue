<template>
    <q-card flat bordered class="sp-package-snapshot">
        <q-card-section class="sp-package-snapshot__head">
            <div>
                <div class="sp-package-snapshot__eyebrow">{{ i18n.packageSnapshotTitle }}</div>
                <p class="sp-package-snapshot__sub">{{ i18n.packageSnapshotSubtitle }}</p>
            </div>
            <q-chip
                v-if="snapshot && capturedAtIso"
                dense
                outline
                color="grey-7"
                :label="`${i18n.packageSnapshotCapturedAt}: ${formatDate(capturedAtIso)}`"
            />
        </q-card-section>

        <q-separator />

        <q-card-section v-if="!snapshot" class="sp-package-snapshot__empty">
            {{ i18n.packageSnapshotNone }}
        </q-card-section>

        <q-card-section v-else>
            <dl class="sp-package-snapshot__list">
                <template v-if="snapshot.label">
                    <dt>{{ i18n.activePlan }}</dt>
                    <dd>{{ snapshot.label }}</dd>
                </template>

                <template v-if="snapshot.planId">
                    <dt>{{ i18n.packageSnapshotPlanLabel }}</dt>
                    <dd>
                        <code>{{ snapshot.planId }}</code>
                        <span v-if="snapshot.planVersionId" class="sp-package-snapshot__muted">
                            ({{ i18n.packageSnapshotPlanVersionLabel }}:
                            <code>{{ snapshot.planVersionId }}</code
                            >)
                        </span>
                    </dd>
                </template>

                <template v-if="cycleLabel">
                    <dt>{{ i18n.packageSnapshotCycleLabel }}</dt>
                    <dd>{{ cycleLabel }}</dd>
                </template>

                <template v-if="checkoutOfferId">
                    <dt>{{ i18n.packageSnapshotOfferRef }}</dt>
                    <dd>
                        <code>{{ checkoutOfferId }}</code>
                    </dd>
                </template>

                <template v-if="snapshot.priceMonthlyNet != null">
                    <dt>{{ i18n.packageSnapshotPriceMonthly }}</dt>
                    <dd>{{ formatCurrency(snapshot.priceMonthlyNet) }}</dd>
                </template>

                <template v-if="snapshot.priceYearlyNet != null">
                    <dt>{{ i18n.packageSnapshotPriceYearly }}</dt>
                    <dd>{{ formatCurrency(snapshot.priceYearlyNet) }}</dd>
                </template>

                <template v-if="snapshot.priceTotalNet != null">
                    <dt>{{ i18n.packageSnapshotPriceTotal }}</dt>
                    <dd>
                        <strong>{{ formatCurrency(snapshot.priceTotalNet) }}</strong>
                    </dd>
                </template>

                <template v-if="bundleVersionIds">
                    <dt>{{ i18n.packageSnapshotBundlesLabel }}</dt>
                    <dd>
                        <span
                            v-if="bundleVersionIds.length === 0"
                            class="sp-package-snapshot__muted"
                        >
                            {{ i18n.packageSnapshotBundlesEmpty }}
                        </span>
                        <ul v-else class="sp-package-snapshot__bundles">
                            <li v-for="id in bundleVersionIds" :key="id">
                                <code>{{ id }}</code>
                            </li>
                        </ul>
                    </dd>
                </template>
            </dl>

            <div class="sp-package-snapshot__raw">
                <q-btn
                    flat
                    dense
                    no-caps
                    size="sm"
                    color="primary"
                    :label="showRaw ? i18n.packageSnapshotHideRaw : i18n.packageSnapshotShowRaw"
                    :icon="showRaw ? 'expand_less' : 'expand_more'"
                    @click="showRaw = !showRaw"
                />
                <pre v-if="showRaw" class="sp-package-snapshot__raw-body">{{ rawJson }}</pre>
            </div>
        </q-card-section>
    </q-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PackageSnapshotShape } from '../use-tenant-billing.js';
import type { TenantPlanSectionI18n } from './default-i18n.js';

// PackageSnapshotPanel — P11.4 (METAMODELL §17a):
// Read-only display of `Subscription.packageSnapshot`. Shows the
// tenant the frozen website offer (offer snapshot) — plan,
// bundles, prices, capture timestamp. No actions, no diff against
// the current state. Deliberately defensive against missing fields, because the
// snapshot schema keeps expanding and older subscriptions are narrower.

interface Props {
    snapshot: PackageSnapshotShape | null;
    checkoutOfferId: string | null;
    i18n: TenantPlanSectionI18n;
    formatDate: (iso: string | Date) => string;
    formatCurrency: (n: number) => string;
}

const props = defineProps<Props>();

const showRaw = ref(false);

const capturedAtIso = computed(() => {
    if (!props.snapshot) return null;
    return typeof props.snapshot.capturedAt === 'string' ? props.snapshot.capturedAt : null;
});

const bundleVersionIds = computed<string[] | null>(() => {
    const ids = props.snapshot?.bundleVersionIds;
    if (!Array.isArray(ids)) return null;
    return ids.filter((id): id is string => typeof id === 'string');
});

const cycleLabel = computed(() => {
    const cycle = props.snapshot?.billingCycle;
    if (cycle === 'YEARLY') return props.i18n.cycleYearly;
    if (cycle === 'MONTHLY') return props.i18n.cycleMonthly;
    return null;
});

const rawJson = computed(() => {
    if (!props.snapshot) return '';
    try {
        return JSON.stringify(props.snapshot, null, 2);
    } catch {
        return String(props.snapshot);
    }
});
</script>

<style scoped>
.sp-package-snapshot {
    --sp-text-muted: rgba(0, 0, 0, 0.55);
    --sp-text-strong: rgba(0, 0, 0, 0.85);
    --sp-border: rgba(0, 0, 0, 0.08);
    --sp-pre-bg: rgba(0, 0, 0, 0.04);
}
body.body--dark .sp-package-snapshot {
    --sp-text-muted: rgba(255, 255, 255, 0.62);
    --sp-text-strong: rgba(255, 255, 255, 0.85);
    --sp-border: rgba(255, 255, 255, 0.16);
    --sp-pre-bg: rgba(255, 255, 255, 0.06);
}
.sp-package-snapshot__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
}
.sp-package-snapshot__eyebrow {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--sp-text-muted);
    margin-bottom: 4px;
    font-weight: 600;
}
.sp-package-snapshot__sub {
    margin: 0;
    color: var(--sp-text-muted);
    font-size: 13px;
}
.sp-package-snapshot__empty {
    color: var(--sp-text-muted);
    font-size: 13px;
    font-style: italic;
}
.sp-package-snapshot__list {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 24px;
    row-gap: 8px;
    margin: 0;
}
.sp-package-snapshot__list dt {
    font-weight: 600;
    color: var(--sp-text-strong);
}
.sp-package-snapshot__list dd {
    margin: 0;
    color: var(--sp-text-strong);
}
.sp-package-snapshot__muted {
    color: var(--sp-text-muted);
    font-size: 13px;
}
.sp-package-snapshot__bundles {
    margin: 0;
    padding-left: 16px;
    list-style: disc;
}
.sp-package-snapshot__raw {
    margin-top: 16px;
    border-top: 1px solid var(--sp-border);
    padding-top: 12px;
}
.sp-package-snapshot__raw-body {
    margin: 8px 0 0;
    padding: 12px;
    background: var(--sp-pre-bg);
    border-radius: 4px;
    font-size: 12px;
    overflow-x: auto;
    max-height: 320px;
}
code {
    font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 12px;
    background: var(--sp-pre-bg);
    padding: 1px 4px;
    border-radius: 3px;
}
</style>
