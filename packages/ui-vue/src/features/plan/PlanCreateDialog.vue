<template>
    <AdminDialog
        :model-value="modelValue"
        :title="msg.createDialog.title"
        :subtitle="msg.createDialog.subtitle"
        size="md"
        persistent
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <div>
            <div class="pcd-row pcd-row--2col">
                <div class="pcd-field">
                    <div class="pcd-field-label">
                        {{ msg.createDialog.labelPlanKey }}
                        <span class="pcd-kbd">UNIQUE</span>
                    </div>
                    <q-input
                        ref="keyInput"
                        :model-value="form.planKey"
                        outlined
                        dense
                        :placeholder="msg.createDialog.placeholderPlanKey"
                        :error="Boolean(keyError)"
                        :error-message="keyError ?? undefined"
                        :hint="msg.createDialog.hintPlanKey"
                        @update:model-value="onPlanKeyInput"
                    />
                </div>
                <div class="pcd-field">
                    <div class="pcd-field-label">{{ msg.createDialog.labelDisplayName }}</div>
                    <q-input
                        outlined
                        dense
                        v-model="form.label"
                        :placeholder="msg.createDialog.placeholderDisplayName"
                    />
                    <div class="pcd-hint">{{ msg.createDialog.hintDisplayName }}</div>
                </div>
            </div>

            <div class="pcd-field">
                <div class="pcd-field-label">{{ common.description }}</div>
                <q-input
                    v-model="form.description"
                    outlined
                    dense
                    type="textarea"
                    :rows="2"
                    :placeholder="msg.createDialog.placeholderDescription"
                />
            </div>

            <div class="pcd-field">
                <div class="pcd-field-label">{{ msg.createDialog.labelBasis }}</div>
                <div class="pcd-choice-grid">
                    <button
                        v-for="opt in choiceOptions"
                        :key="opt.key"
                        type="button"
                        :class="['pcd-choice', { 'pcd-choice--selected': form.basis === opt.key }]"
                        @click="form.basis = opt.key"
                    >
                        <div class="pcd-choice-title">{{ opt.title }}</div>
                        <div class="pcd-choice-sub">{{ opt.subtitle }}</div>
                    </button>
                </div>
            </div>
        </div>
        <template #footer>
            <div class="pcd-foot">
                <button class="pcd-btn pcd-btn--ghost" type="button" @click="onCancel">
                    {{ common.cancel }}
                </button>
                <button
                    class="pcd-btn pcd-btn--primary"
                    type="button"
                    :disabled="!canSubmit || submitting"
                    @click="onSubmit"
                >
                    <span>{{
                        submitting ? msg.createDialog.submitting : msg.createDialog.submit
                    }}</span>
                    <span class="pcd-ico" aria-hidden="true">
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
        </template>
    </AdminDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import AdminDialog from '../../ui/overlay/AdminDialog.vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// PlanCreateDialog — step 1 of the "new plan" flow from the plan
// simulation. Collects the plan master data (key, label, description) plus the
// basis for the first draft version (empty or a clone of an existing plan).
// On "Weiter" the dialog emits the complete submit payload; the
// hosting page (PlansPage) creates the plan and opens the V2 editor
// with the cloned initial form.

export interface TemplateOption {
    /** "empty" or plan key. */
    key: string;
    label: string;
    features: string[];
    quotas: Record<string, number>;
    bundles: string[];
}

export interface PlanCreateSubmit {
    planKey: string;
    label: string;
    description: string;
    basis: string;
    initialFeatures: string[];
    initialQuotas: Record<string, number>;
    initialBundles: string[];
}

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        /** Available clone templates (except "empty"). Default: empty (only "Leerer Plan"). */
        availableTemplates?: TemplateOption[];
        /** Plan keys that already exist — for uniqueness validation. */
        existingPlanKeys?: string[];
        /** Optionally preselected basis (e.g. when started from a "Klon" button). */
        defaultBasis?: string;
        submitting?: boolean;
    }>(),
    {
        availableTemplates: () => [],
        existingPlanKeys: () => [],
        defaultBasis: 'empty',
        submitting: false,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'submit', payload: PlanCreateSubmit): void;
    (e: 'cancel'): void;
}>();

const msg = useSaMessages('plans');
const common = useSaMessages('common');

const emptyBasis = computed<TemplateOption>(() => ({
    key: 'empty',
    label: msg.value.createDialog.emptyPlan,
    features: [],
    quotas: {},
    bundles: [],
}));

const form = reactive({
    planKey: '',
    label: '',
    description: '',
    basis: 'empty',
});

const keyInput = ref<HTMLInputElement | null>(null);

// Open → reset state + focus.
watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        form.planKey = '';
        form.label = '';
        form.description = '';
        form.basis = props.defaultBasis;
        setTimeout(() => keyInput.value?.focus(), 50);
    },
);

function onPlanKeyInput(e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    form.planKey = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '');
}

const keyError = computed<string | null>(() => {
    if (!form.planKey) return null;
    if (!/^[A-Z][A-Z0-9_]*$/.test(form.planKey)) {
        return msg.value.createDialog.errorKeyFormat;
    }
    if (props.existingPlanKeys.includes(form.planKey)) {
        return formatMessage(msg.value.createDialog.errorKeyExists, { key: form.planKey });
    }
    return null;
});

const canSubmit = computed(
    () => form.planKey.length > 0 && form.label.trim().length > 0 && keyError.value === null,
);

const choiceOptions = computed(() => {
    const options = [
        {
            key: 'empty',
            title: msg.value.createDialog.emptyPlan,
            subtitle: msg.value.createDialog.emptyPlanHint,
        },
        ...props.availableTemplates.map((t) => ({
            key: t.key,
            title: formatMessage(msg.value.createDialog.cloneOf, { label: t.label }),
            subtitle: countsLabel(t),
        })),
    ];
    return options;
});

function countsLabel(t: TemplateOption): string {
    return formatMessage(msg.value.createDialog.counts, {
        features: t.features.length,
        quotas: Object.keys(t.quotas).length,
        bundles: t.bundles.length,
    });
}

function selectedTemplate(): TemplateOption {
    if (form.basis === 'empty') return emptyBasis.value;
    return props.availableTemplates.find((t) => t.key === form.basis) ?? emptyBasis.value;
}

function onSubmit(): void {
    if (!canSubmit.value || props.submitting) return;
    const tpl = selectedTemplate();
    emit('submit', {
        planKey: form.planKey,
        label: form.label.trim(),
        description: form.description.trim(),
        basis: form.basis,
        initialFeatures: [...tpl.features],
        initialQuotas: { ...tpl.quotas },
        initialBundles: [...tpl.bundles],
    });
}

function onCancel(): void {
    emit('cancel');
    emit('update:modelValue', false);
}
</script>

<style scoped>
.pcd-row {
    margin-bottom: var(--sa-space-5);
}
.pcd-row--2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sa-space-4);
    margin-bottom: var(--sa-space-5);
}
.pcd-field {
    margin-bottom: var(--sa-space-5);
}
.pcd-row--2col .pcd-field {
    margin-bottom: 0;
}
.pcd-row .pcd-field:last-child,
.pcd-field-label {
    font-size: var(--sa-text-sm);
    font-weight: 600;
    color: var(--sa-color-fg-body);
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    margin-bottom: var(--sa-space-2);
}
.pcd-kbd {
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    padding: var(--sa-space-1) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
    border: 1px solid var(--sa-color-border);
    letter-spacing: var(--sa-tracking-wide);
}
.pcd-hint {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    margin-top: var(--sa-space-2);
}
.pcd-choice-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sa-space-3);
}
.pcd-choice {
    border: 1.5px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-4) var(--sa-space-4);
    cursor: pointer;
    background: var(--sa-color-bg-surface);
    text-align: left;
    transition:
        border-color 0.12s,
        background 0.12s,
        box-shadow 0.12s;
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-1);
    font-family: inherit;
}
.pcd-choice:hover {
    background: var(--sa-color-bg-sunken);
}
.pcd-choice--selected {
    border-color: var(--sa-color-accent);
    background: var(--sa-color-accent-surface);
    box-shadow: 0 0 0 3px var(--sa-shadow-tint-2);
}
.pcd-choice-title {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.pcd-choice-sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
}

.pcd-foot {
    padding: var(--sa-space-4) var(--sa-space-6);
    background: var(--sa-color-bg-surface-raised);
    border-top: 1px solid var(--sa-color-border);
    display: flex;
    justify-content: flex-end;
    gap: var(--sa-space-3);
}
.pcd-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-5);
    border-radius: var(--sa-radius-control);
    font: 500 var(--sa-text-md) var(--sa-font-body);
    cursor: pointer;
    border: 1px solid var(--sa-color-border-strong);
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-heading);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.pcd-btn:hover:not(:disabled) {
    background: var(--sa-color-bg-sunken);
}
.pcd-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.pcd-btn--ghost {
    border-color: transparent;
    background: transparent;
}
.pcd-btn--ghost:hover {
    background: var(--sa-color-bg-sunken);
}
.pcd-btn--primary {
    background: var(--sa-color-accent);
    border-color: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
}
.pcd-btn--primary:hover:not(:disabled) {
    background: var(--sa-color-accent-strong);
}
.pcd-ico {
    display: inline-flex;
}

@media (max-width: 599.98px) {
    .pcd-row--2col,
    .pcd-choice-grid {
        grid-template-columns: 1fr;
    }
}
</style>
