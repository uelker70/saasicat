<template>
    <header class="pve-bar">
        <div class="pve-bar-left">
            <div class="pve-titlechip">
                <span class="pve-titlechip-kicker">PLAN</span>
                <span class="pve-chip pve-chip--plan">{{ planKey }}</span>
            </div>
            <h2 class="pve-title">
                {{ editingId ? `Draft v${version} bearbeiten` : `Neue Version v${version}` }}
            </h2>
            <span class="pve-chip pve-chip--draft pve-chip--dot">Draft</span>
            <span class="pve-bar-note">
                Vorgänger wird beim Publish auf
                <code class="pve-mono">{{ predecessorValidUntilHint }}</code> superseded
            </span>
        </div>
        <div class="pve-bar-right">
            <button
                class="pve-btn"
                type="button"
                :disabled="!hasPredecessor"
                :title="hasPredecessor ? undefined : 'Keine Vorgänger-Version (v1)'"
                @click="$emit('showDiff')"
            >
                <span class="pve-ico" aria-hidden="true">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                </span>
                <span>Diff vs. Vorgänger</span>
            </button>
            <button class="pve-btn" type="button" @click="$emit('cancel')">
                <span class="pve-ico" style="transform: rotate(180deg)" aria-hidden="true">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                </span>
                <span>Zurück</span>
            </button>
            <button
                class="pve-btn pve-btn--primary"
                type="button"
                :disabled="!canSave"
                @click="$emit('save')"
            >
                <span>Weiter · Review</span>
                <span class="pve-ico" aria-hidden="true">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                </span>
            </button>
        </div>
    </header>
</template>

<script setup lang="ts">
defineProps<{
    planKey: string;
    editingId: string | null;
    version: number;
    predecessorValidUntilHint: string;
    hasPredecessor: boolean;
    canSave: boolean;
}>();

defineEmits<{
    (e: 'showDiff'): void;
    (e: 'cancel'): void;
    (e: 'save'): void;
}>();
</script>
