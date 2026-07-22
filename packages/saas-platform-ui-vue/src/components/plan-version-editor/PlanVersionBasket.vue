<template>
    <section
        class="pve-col pve-basket"
        :class="{ 'pve-basket--dragover': dragOver }"
        @dragover.prevent="$emit('drag-over', $event)"
        @dragleave="$emit('drag-leave', $event)"
        @drop.prevent="$emit('drop')"
    >
        <div class="pve-col-header pve-col-header--basket">
            <div>
                <div class="pve-col-title">{{ title }}</div>
                <div class="pve-col-sub">{{ msg.basket.subtitle }}</div>
            </div>
            <span class="pve-chip pve-chip--changes">{{ changeCountLabel }}</span>
        </div>

        <div class="pve-basket-settings">
            <div class="pve-bs-row">
                <div class="pve-bs-label">{{ msg.basket.validFrom }}</div>
                <input
                    class="pve-bs-input"
                    :class="{ 'pve-bs-input--error': !!validFromError }"
                    type="date"
                    :min="minValidFrom"
                    :value="form.validFrom ?? ''"
                    placeholder="YYYY-MM-DD"
                    @input="emitTextInput('update:validFrom', $event)"
                />
                <div class="pve-bs-label pve-bs-label--inline">{{ msg.basket.until }}</div>
                <input
                    class="pve-bs-input"
                    type="date"
                    :value="form.validUntil ?? ''"
                    placeholder="∞"
                    @input="emitTextInput('update:validUntil', $event)"
                />
            </div>
            <div v-if="validFromError" class="pve-bs-error">
                <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"
                    />
                </svg>
                <span>{{ validFromError }}</span>
            </div>
            <div class="pve-bs-row">
                <div class="pve-bs-label">{{ msg.sections.price }}</div>
                <div class="pve-bs-input-grp">
                    <span class="pve-bs-prefix">€</span>
                    <input
                        class="pve-bs-input pve-bs-input--flush"
                        :value="form.monthlyNet"
                        inputmode="decimal"
                        @input="emitTextInput('update:monthlyNet', $event)"
                    />
                    <span class="pve-bs-suffix">{{ msg.perMonthShort }}</span>
                </div>
                <div class="pve-bs-input-grp pve-bs-input-grp--gap">
                    <span class="pve-bs-prefix">€</span>
                    <input
                        class="pve-bs-input pve-bs-input--flush"
                        :value="form.yearlyNet"
                        inputmode="decimal"
                        @input="emitTextInput('update:yearlyNet', $event)"
                    />
                    <span class="pve-bs-suffix">{{ msg.perYearShort }}</span>
                </div>
            </div>
            <div class="pve-bs-row">
                <div class="pve-bs-label">{{ msg.basket.inPublicCatalog }}</div>
                <label class="pve-toggle">
                    <input type="checkbox" :checked="form.marketed" @change="emitCheckboxInput" />
                    <span />
                </label>
                <input
                    class="pve-bs-input pve-bs-input--grow"
                    :value="form.changeNote"
                    :placeholder="msg.basket.changeNotePlaceholder"
                    @input="emitTextInput('update:changeNote', $event)"
                />
            </div>
        </div>

        <div class="pve-basket-group">
            <div class="pve-bg-header">
                <span class="pve-bg-dot pve-bg-dot--quota" />
                <span class="pve-bg-title">{{ msg.sections.quotas }}</span>
                <span class="pve-bg-count">{{ assignedCount(selectedQuotaList.length) }}</span>
            </div>
            <div class="pve-dz">
                <div v-for="row in selectedQuotaList" :key="row.quotaKey" class="pve-sel-row">
                    <span class="pve-sel-dot pve-sel-dot--quota" />
                    <div class="pve-sel-body">
                        <div class="pve-sel-label">{{ row.label }}</div>
                        <div class="pve-sel-sub">{{ row.sub }}</div>
                    </div>
                    <div class="pve-sel-val-edit">
                        <input
                            class="pve-sel-val-input"
                            type="number"
                            :value="form.quotas[row.quotaKey]"
                            @input="emitQuotaInput(row.quotaKey, $event)"
                        />
                        <span class="pve-sel-val-unit">{{ row.unit }}</span>
                    </div>
                    <button
                        class="pve-sel-x"
                        type="button"
                        :aria-label="msg.basket.removeQuota"
                        @click="$emit('toggle-quota', row.quotaKey, false)"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div v-if="selectedQuotaList.length === 0" class="pve-dz-empty">
                    {{ msg.basket.emptyQuotas }}
                </div>
            </div>
        </div>

        <div class="pve-basket-group">
            <div class="pve-bg-header">
                <span class="pve-bg-dot pve-bg-dot--feature" />
                <span class="pve-bg-title">{{ msg.sections.features }}</span>
                <span class="pve-bg-count">{{ assignedCount(form.features.length) }}</span>
            </div>
            <div class="pve-dz">
                <div v-for="key in sortedSelectedFeatures" :key="key" class="pve-sel-row">
                    <span class="pve-sel-dot pve-sel-dot--feature" />
                    <div class="pve-sel-body">
                        <div class="pve-sel-label">{{ featureLabel(key) }}</div>
                        <div class="pve-sel-sub">{{ key }}</div>
                    </div>
                    <button
                        class="pve-sel-x"
                        type="button"
                        :aria-label="msg.basket.removeFeature"
                        @click="$emit('toggle-feature', key, false)"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div v-if="form.features.length === 0" class="pve-dz-empty">
                    {{ msg.basket.emptyFeatures }}
                </div>
            </div>
        </div>

        <div class="pve-basket-group">
            <div class="pve-bg-header">
                <span class="pve-bg-dot pve-bg-dot--bundle" />
                <span class="pve-bg-title">{{ msg.sections.bundles }}</span>
                <span class="pve-bg-count">{{ assignedCount(activeBundles.length) }}</span>
            </div>
            <div class="pve-dz">
                <div v-for="b in activeBundles" :key="b.bundleKey" class="pve-sel-row">
                    <span class="pve-sel-dot pve-sel-dot--bundle" />
                    <div class="pve-sel-body">
                        <div class="pve-sel-label">{{ b.label || b.bundleKey }}</div>
                        <div class="pve-sel-sub">
                            {{ b.bundleKey }} · {{ bundleFeatureCount(b.features.length) }}
                        </div>
                    </div>
                    <button
                        class="pve-sel-x"
                        type="button"
                        :aria-label="msg.basket.removeBundle"
                        @click="$emit('toggle-bundle', b, false)"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div v-if="activeBundles.length === 0" class="pve-dz-empty pve-dz-empty--center">
                    {{ msg.basket.emptyBundles }}
                </div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { BundleEntry, DraftForm, SelectedQuotaRow } from './types.js';

const props = defineProps<{
    form: DraftForm;
    dragOver: boolean;
    changeCount: number;
    minValidFrom?: string;
    validFromError: string | null;
    selectedQuotaList: SelectedQuotaRow[];
    sortedSelectedFeatures: string[];
    activeBundles: BundleEntry[];
    featureLabel: (key: string) => string;
}>();

const emit = defineEmits<{
    (e: 'update:validFrom', value: string | null): void;
    (e: 'update:validUntil', value: string | null): void;
    (e: 'update:monthlyNet', value: string): void;
    (e: 'update:yearlyNet', value: string): void;
    (e: 'update:marketed', value: boolean): void;
    (e: 'update:changeNote', value: string): void;
    (e: 'set-quota-value', key: string, value: number): void;
    (e: 'toggle-quota', key: string, on: boolean): void;
    (e: 'toggle-feature', key: string, on: boolean): void;
    (e: 'toggle-bundle', bundle: BundleEntry, on: boolean): void;
    (e: 'drag-over', event: DragEvent): void;
    (e: 'drag-leave', event: DragEvent): void;
    (e: 'drop'): void;
}>();

const msg = useSaMessages('planEditor');

const title = computed(() =>
    formatMessage(msg.value.basket.title, { version: props.form.version }),
);

const changeCountLabel = computed(() =>
    formatMessage(msg.value.basket.changeCount, { count: props.changeCount }),
);

function assignedCount(count: number): string {
    return formatMessage(msg.value.basket.assignedCount, { count });
}

function bundleFeatureCount(count: number): string {
    return formatMessage(msg.value.basket.bundleFeatureCount, { count });
}

type TextInputEvent =
    | 'update:validFrom'
    | 'update:validUntil'
    | 'update:monthlyNet'
    | 'update:yearlyNet'
    | 'update:changeNote';

function emitTextInput(name: TextInputEvent, event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    switch (name) {
        case 'update:validFrom':
            emit('update:validFrom', value || null);
            return;
        case 'update:validUntil':
            emit('update:validUntil', value || null);
            return;
        case 'update:monthlyNet':
            emit('update:monthlyNet', value);
            return;
        case 'update:yearlyNet':
            emit('update:yearlyNet', value);
            return;
        case 'update:changeNote':
            emit('update:changeNote', value);
    }
}

function emitCheckboxInput(event: Event): void {
    emit('update:marketed', (event.target as HTMLInputElement | null)?.checked ?? false);
}

function emitQuotaInput(key: string, event: Event): void {
    const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
    emit('set-quota-value', key, value);
}
</script>
