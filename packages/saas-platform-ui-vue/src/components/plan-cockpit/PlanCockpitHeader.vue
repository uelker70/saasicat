<template>
    <div class="pc-backbar">
        <button class="pc-back" type="button" @click="emit('back')">
            <span class="pc-back-ico" aria-hidden="true">
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
            <span>Zurück zur Liste</span>
        </button>
    </div>

    <div class="pc-header">
        <div class="pc-header-left">
            <div class="pc-bigchip" :style="{ background: accentBg, color: accentFg }">
                {{ plan.planKey }}
            </div>
            <div class="pc-header-titles">
                <h2 class="pc-h-title">{{ plan.label }}</h2>
                <p class="pc-h-sub">{{ plan.description || 'Keine Beschreibung.' }}</p>
            </div>
        </div>
        <div class="pc-header-right">
            <button class="pc-btn" type="button" @click="emit('clonePlan')">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 012-2h10" />
                </svg>
                <span>Plan klonen</span>
            </button>
            <button class="pc-btn" type="button" @click="emit('viewCatalog')">
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
                <span>Im Katalog ansehen</span>
            </button>
            <button
                class="pc-btn pc-btn--primary"
                type="button"
                :disabled="hasOpenDraft"
                :title="hasOpenDraft ? 'Es gibt bereits eine offene Draft' : undefined"
                @click="emit('createDraft')"
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                >
                    <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Neue Draft-Version</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { PlanRow } from '@saasicat/types';

defineProps<{
    plan: PlanRow;
    accentBg: string;
    accentFg: string;
    hasOpenDraft: boolean;
}>();

const emit = defineEmits<{
    (e: 'back'): void;
    (e: 'clonePlan'): void;
    (e: 'viewCatalog'): void;
    (e: 'createDraft'): void;
}>();
</script>
