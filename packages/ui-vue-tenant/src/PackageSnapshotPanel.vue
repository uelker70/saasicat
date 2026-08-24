<template>
    <TenantCard class="sp-package-snapshot">
        <TenantCardSection class="sp-package-snapshot__head">
            <div>
                <div class="sp-package-snapshot__eyebrow">{{ i18n.packageSnapshotTitle }}</div>
                <p class="sp-package-snapshot__sub">{{ i18n.packageSnapshotSubtitle }}</p>
            </div>
            <span v-if="snapshot && capturedAtIso" class="sp-chip">
                {{ i18n.packageSnapshotCapturedAt }}: {{ formatDate(capturedAtIso) }}
            </span>
        </TenantCardSection>

        <hr class="sp-divider" />

        <TenantCardSection v-if="!snapshot" class="sp-package-snapshot__empty">
            {{ i18n.packageSnapshotNone }}
        </TenantCardSection>

        <TenantCardSection v-else>
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
                <TenantButton
                    variant="quiet"
                    tone="accent"
                    :aria-expanded="showRaw"
                    :aria-controls="rawId"
                    @click="showRaw = !showRaw"
                >
                    {{ showRaw ? i18n.packageSnapshotHideRaw : i18n.packageSnapshotShowRaw }}
                    <svg
                        class="sp-package-snapshot__caret"
                        :class="{ 'sp-package-snapshot__caret--open': showRaw }"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </TenantButton>
                <pre v-if="showRaw" :id="rawId" class="sp-package-snapshot__raw-body">{{
                    rawJson
                }}</pre>
            </div>
        </TenantCardSection>
    </TenantCard>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useTenantI18n } from './tenant-i18n.js';
import TenantButton from './ui/TenantButton.vue';
import TenantCard from './ui/TenantCard.vue';
import TenantCardSection from './ui/TenantCardSection.vue';
import './ui/tenant-ui.css';
import type { PackageSnapshotShape } from '@saasicat/ui-vue';

// PackageSnapshotPanel — P11.4:
// Read-only display of `Subscription.packageSnapshot`. Shows the
// tenant the frozen website offer (offer snapshot) — plan,
// bundles, prices, capture timestamp. No actions, no diff against
// the current state. Deliberately defensive against missing fields, because the
// snapshot schema keeps expanding and older subscriptions are narrower.

const i18n = useTenantI18n();

interface Props {
    snapshot: PackageSnapshotShape | null;
    checkoutOfferId: string | null;
    formatDate: (iso: string | Date) => string;
    formatCurrency: (n: number) => string;
}

const props = defineProps<Props>();

// sa-disclosure-exempt(toggles `showRaw`, writes `aria-expanded`):
// a tenant-facing raw payload toggle, in the package that left
//
// The admin has one disclosure, `AdminAccordion`, and every surface there uses
// it. This one is outside the admin twice over.
//
// It is outside by AUDIENCE: this package renders inside the customer's own
// application, for the paying tenant rather than the operator, with its own
// translations. Reaching into the admin's component layer from here would put
// that package's stack back into an application that did not choose it — which
// is the whole point of ADR 0010.
//
// It is outside by SHAPE: `AdminAccordion` is a row in a list whose header
// opens its body — the design guide calls the pattern "rows that open". This is
// a card with a `<pre>` of raw JSON behind a quiet button at its foot, and
// wrapping that in an accordion card would seat a bordered card inside a
// bordered card to say "this opens".
//
// What it does take from the shared one is the half that is not layout. The
// trigger was always a real `<button>` with a label — the accessibility gap
// here was never the keyboard, only that nothing said the button expands
// something or what it expands. `role="region"` is deliberately not copied: the
// accordion's body is named by a trigger that carries the row's title, and this
// trigger's name is "Show raw JSON".
const showRaw = ref(false);
const rawId = useId();

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
    if (cycle === 'YEARLY') return i18n.value.cycleYearly;
    if (cycle === 'MONTHLY') return i18n.value.cycleMonthly;
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
    --sp-text-muted: var(--sa-color-fg-muted);
    --sp-text-strong: var(--sa-color-fg-heading);
    --sp-border: var(--sa-color-border);
    --sp-pre-bg: var(--sa-color-bg-sunken);
}
.sp-package-snapshot__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--sa-space-5);
    flex-wrap: wrap;
}
.sp-package-snapshot__eyebrow {
    font-size: var(--sa-text-sm);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sp-text-muted);
    margin-bottom: var(--sa-space-2);
    font-weight: 600;
}
.sp-package-snapshot__sub {
    margin: 0;
    color: var(--sp-text-muted);
    font-size: var(--sa-text-md);
}
.sp-package-snapshot__empty {
    color: var(--sp-text-muted);
    font-size: var(--sa-text-md);
    font-style: italic;
}
.sp-package-snapshot__list {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: var(--sa-space-7);
    row-gap: var(--sa-space-3);
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
    font-size: var(--sa-text-md);
}
.sp-package-snapshot__bundles {
    margin: 0;
    padding-left: var(--sa-space-5);
    list-style: disc;
}
.sp-package-snapshot__caret {
    transition: transform 120ms ease;
}
.sp-package-snapshot__caret--open {
    transform: rotate(180deg);
}
@media (prefers-reduced-motion: reduce) {
    .sp-package-snapshot__caret {
        transition: none;
    }
}
.sp-package-snapshot__raw {
    margin-top: var(--sa-space-5);
    border-top: 1px solid var(--sp-border);
    padding-top: var(--sa-space-4);
}
.sp-package-snapshot__raw-body {
    margin: var(--sa-space-3) 0 0;
    padding: var(--sa-space-4);
    background: var(--sp-pre-bg);
    border-radius: var(--sa-radius-badge);
    font-size: var(--sa-text-sm);
    overflow-x: auto;
    max-height: 320px;
}
code {
    font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: var(--sa-text-sm);
    background: var(--sp-pre-bg);
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
}
</style>
