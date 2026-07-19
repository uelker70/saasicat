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
// PendingVersionBanner — informiert Tenant über eine anstehende PlanVersion-
// Änderung (Phase-4-Roadmap). Für regressive (= einschränkende) Änderungen
// erfordert die Plattform eine explizite Bestätigung — der Banner bietet
// einen "Akzeptieren"-Button. Für non-regressive Änderungen läuft das per
// Renewal-Cron automatisch durch.

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
    border: 1px solid rgba(242, 192, 55, 0.4);
    background: rgba(242, 192, 55, 0.08);
    border-radius: 6px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.sp-pending-version__head {
    display: flex;
    align-items: center;
    gap: 10px;
}
.sp-pending-version__chip {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
}
.sp-pending-version__chip--good {
    background: rgba(33, 186, 69, 0.15);
    color: var(--q-positive, #21ba45);
}
.sp-pending-version__chip--warn {
    background: rgba(193, 0, 21, 0.15);
    color: var(--q-negative, #c10015);
}
.sp-pending-version__note {
    margin: 0;
    color: rgba(0, 0, 0, 0.75);
}
.sp-pending-version__effective,
.sp-pending-version__accepted {
    margin: 0;
    font-size: 13px;
    color: rgba(0, 0, 0, 0.6);
}
.sp-pending-version__btn {
    align-self: flex-start;
    padding: 6px 14px;
    border-radius: 4px;
    border: 0;
    background: var(--q-primary, #1976d2);
    color: white;
    font-weight: 600;
    cursor: pointer;
}
.sp-pending-version__btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
</style>
