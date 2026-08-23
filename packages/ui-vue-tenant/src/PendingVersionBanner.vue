<template>
    <div v-if="pending" class="sp-pending-version">
        <div class="sp-pending-version__head">
            <strong>{{ i18n.title }}</strong>
            <span
                v-if="pending.nonRegressive"
                class="sp-pending-version__chip sp-pending-version__chip--good"
            >
                {{ i18n.chipNonRegressive }}
            </span>
            <span v-else class="sp-pending-version__chip sp-pending-version__chip--warn">
                {{ i18n.chipRegressive }}
            </span>
        </div>
        <p v-if="pending.changeNote" class="sp-pending-version__note">
            {{ pending.changeNote }}
        </p>
        <p v-if="effectiveAt" class="sp-pending-version__effective">
            {{ i18n.effectiveAt }}: {{ formatDate(effectiveAt) }}
        </p>
        <div v-if="!pending.nonRegressive && !accepted" class="sp-pending-version__actions">
            <button class="sp-pending-version__btn" :disabled="busy" @click="$emit('accept')">
                {{ busy ? i18n.acceptInProgress : i18n.acceptAction }}
            </button>
        </div>
        <p v-if="accepted" class="sp-pending-version__accepted">
            {{ i18n.acceptedAt }}: {{ acceptedAt ? formatDate(acceptedAt) : '' }}
        </p>
    </div>
</template>

<script setup lang="ts">
// PendingVersionBanner — informs the tenant about an upcoming PlanVersion
// change (Phase 4 roadmap). For regressive (= restricting) changes
// the platform requires an explicit confirmation — the banner provides
// an "Accept" button. For non-regressive changes this runs automatically
// via the renewal cron.

interface PendingPlanVersion {
    id: string;
    planId: string;
    version: number;
    nonRegressive: boolean;
    changeNote: string | null;
    publishedChanges: unknown;
}

interface I18nStrings {
    title: string;
    chipNonRegressive: string;
    chipRegressive: string;
    effectiveAt: string;
    acceptAction: string;
    acceptInProgress: string;
    acceptedAt: string;
}

interface Props {
    pending: PendingPlanVersion | null;
    effectiveAt: string | null;
    accepted: boolean;
    acceptedAt: string | null;
    busy?: boolean;
    formatDate: (iso: string) => string;
    i18n: I18nStrings;
}

defineProps<Props>();
defineEmits<{ accept: [] }>();
</script>

<style scoped>
.sp-pending-version {
    border: 1px solid var(--sa-color-warning-border);
    background: var(--sa-color-warning-surface);
    border-radius: var(--sa-radius-badge);
    padding: var(--sa-space-4) var(--sa-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.sp-pending-version__head {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.sp-pending-version__chip {
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-card);
    font-size: var(--sa-text-sm);
    font-weight: 600;
    text-transform: uppercase;
}
.sp-pending-version__chip--good {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive);
}
.sp-pending-version__chip--warn {
    background: var(--sa-color-negative-surface-strong);
    color: var(--sa-color-negative);
}
.sp-pending-version__note {
    margin: 0;
    color: var(--sa-color-fg-body);
}
.sp-pending-version__effective,
.sp-pending-version__accepted {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
.sp-pending-version__btn {
    align-self: flex-start;
    padding: var(--sa-space-2) var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
    border: 0;
    background: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
    font-weight: 600;
    cursor: pointer;
}
.sp-pending-version__btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
</style>
