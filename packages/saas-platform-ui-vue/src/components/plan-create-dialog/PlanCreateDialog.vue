<template>
    <q-dialog
        :model-value="modelValue"
        @update:model-value="$emit('update:modelValue', $event)"
        persistent
        :no-shake="true"
    >
        <div class="pcd-modal" role="dialog" aria-labelledby="pcd-title">
            <div class="pcd-head">
                <div class="pcd-head-text">
                    <div id="pcd-title" class="pcd-title">Neuen Plan anlegen</div>
                    <div class="pcd-sub">
                        Plan-Stamm anlegen. Im nächsten Schritt weist du Features, Quotas und
                        Bundles zu.
                    </div>
                </div>
                <button class="pcd-close" type="button" aria-label="Schließen" @click="onCancel">
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

            <div class="pcd-body">
                <div class="pcd-row pcd-row--2col">
                    <div class="pcd-field">
                        <div class="pcd-field-label">
                            Plan-Key
                            <span class="pcd-kbd">UNIQUE</span>
                        </div>
                        <input
                            ref="keyInput"
                            class="pcd-input"
                            :class="{ 'pcd-input--error': keyError }"
                            placeholder="z. B. SCALE"
                            :value="form.planKey"
                            @input="onPlanKeyInput"
                        />
                        <div v-if="keyError" class="pcd-hint pcd-hint--error">{{ keyError }}</div>
                        <div v-else class="pcd-hint">
                            Großbuchstaben + Unterstriche · API-stabil, nicht änderbar nach Publish
                        </div>
                    </div>
                    <div class="pcd-field">
                        <div class="pcd-field-label">Anzeigename</div>
                        <input class="pcd-input" placeholder="z. B. Scale" v-model="form.label" />
                        <div class="pcd-hint">Wie der Plan im Catalog erscheint</div>
                    </div>
                </div>

                <div class="pcd-field">
                    <div class="pcd-field-label">Beschreibung</div>
                    <textarea
                        class="pcd-input pcd-input--textarea"
                        rows="2"
                        placeholder="Was bekommt der Kunde mit diesem Plan?"
                        v-model="form.description"
                    />
                </div>

                <div class="pcd-field">
                    <div class="pcd-field-label">Basis für die erste Version</div>
                    <div class="pcd-choice-grid">
                        <button
                            v-for="opt in choiceOptions"
                            :key="opt.key"
                            type="button"
                            :class="[
                                'pcd-choice',
                                { 'pcd-choice--selected': form.basis === opt.key },
                            ]"
                            @click="form.basis = opt.key"
                        >
                            <div class="pcd-choice-title">{{ opt.title }}</div>
                            <div class="pcd-choice-sub">{{ opt.subtitle }}</div>
                        </button>
                    </div>
                </div>
            </div>

            <div class="pcd-foot">
                <button class="pcd-btn pcd-btn--ghost" type="button" @click="onCancel">
                    Abbrechen
                </button>
                <button
                    class="pcd-btn pcd-btn--primary"
                    type="button"
                    :disabled="!canSubmit || submitting"
                    @click="onSubmit"
                >
                    <span>{{ submitting ? 'Wird angelegt…' : 'Weiter · Komponenten' }}</span>
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
        </div>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

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

const EMPTY_BASIS: TemplateOption = {
    key: 'empty',
    label: 'Leerer Plan',
    features: [],
    quotas: {},
    bundles: [],
};

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
        return 'Muss mit Buchstabe beginnen, nur A–Z, 0–9, _.';
    }
    if (props.existingPlanKeys.includes(form.planKey)) {
        return `„${form.planKey}" existiert bereits.`;
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
            title: 'Leerer Plan',
            subtitle: 'Im Editor alles selbst zusammenstellen',
        },
        ...props.availableTemplates.map((t) => ({
            key: t.key,
            title: `Klon von ${t.label}`,
            subtitle: countsLabel(t),
        })),
    ];
    return options;
});

function countsLabel(t: TemplateOption): string {
    const parts = [
        `${t.features.length} Features`,
        `${Object.keys(t.quotas).length} Quotas`,
        `${t.bundles.length} Bundles`,
    ];
    return parts.join(' · ');
}

function selectedTemplate(): TemplateOption {
    if (form.basis === 'empty') return EMPTY_BASIS;
    return props.availableTemplates.find((t) => t.key === form.basis) ?? EMPTY_BASIS;
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
.pcd-modal {
    --pcd-bg: #ffffff;
    --pcd-border: #e5e7eb;
    --pcd-border-strong: #d1d5db;
    --pcd-text: #0f172a;
    --pcd-text-2: #475569;
    --pcd-text-3: #94a3b8;
    --pcd-primary: #2563eb;
    --pcd-primary-700: #1d4ed8;
    --pcd-danger: #ef4444;
    --pcd-font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --pcd-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    background: var(--pcd-bg);
    width: 640px;
    max-width: 92vw;
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.3);
    overflow: hidden;
    font-family: var(--pcd-font-sans);
    color: var(--pcd-text);
}
.pcd-modal * {
    box-sizing: border-box;
}

.pcd-head {
    padding: 18px 22px;
    border-bottom: 1px solid var(--pcd-border);
    display: flex;
    align-items: flex-start;
    gap: 12px;
}
.pcd-head-text {
    flex: 1;
    min-width: 0;
}
.pcd-title {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
}
.pcd-sub {
    font-size: 12px;
    color: #64748b;
    margin-top: 3px;
}
.pcd-close {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    border: 0;
    color: var(--pcd-text-3);
    cursor: pointer;
    display: grid;
    place-items: center;
}
.pcd-close:hover {
    background: rgba(15, 23, 42, 0.05);
    color: var(--pcd-text);
}

.pcd-body {
    padding: 20px 22px;
    max-height: calc(90vh - 200px);
    overflow-y: auto;
}
.pcd-row {
    margin-bottom: 16px;
}
.pcd-row--2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 16px;
}
.pcd-field {
    margin-bottom: 16px;
}
.pcd-row--2col .pcd-field {
    margin-bottom: 0;
}
.pcd-row .pcd-field:last-child,
.pcd-body > .pcd-field:last-child {
    margin-bottom: 0;
}
.pcd-field-label {
    font-size: 12px;
    font-weight: 600;
    color: #334155;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
}
.pcd-kbd {
    font: 600 10.5px var(--pcd-font-mono);
    background: #f1f5f9;
    color: #475569;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid #e2e8f0;
    letter-spacing: 0.04em;
}
.pcd-input {
    width: 100%;
    padding: 9px 12px;
    background: #fff;
    border: 1px solid var(--pcd-border);
    border-radius: 7px;
    font: 13.5px var(--pcd-font-sans);
    color: var(--pcd-text);
    outline: none;
    transition:
        border-color 0.12s,
        box-shadow 0.12s;
}
.pcd-input--textarea {
    resize: vertical;
    min-height: 56px;
    line-height: 1.5;
}
.pcd-input:focus {
    border-color: var(--pcd-primary);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
.pcd-input--error {
    border-color: var(--pcd-danger);
}
.pcd-input--error:focus {
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12);
}
.pcd-hint {
    font-size: 11px;
    color: var(--pcd-text-3);
    margin-top: 4px;
}
.pcd-hint--error {
    color: var(--pcd-danger);
}

.pcd-choice-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}
.pcd-choice {
    border: 1.5px solid var(--pcd-border);
    border-radius: 9px;
    padding: 12px 14px;
    cursor: pointer;
    background: #fff;
    text-align: left;
    transition:
        border-color 0.12s,
        background 0.12s,
        box-shadow 0.12s;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-family: inherit;
}
.pcd-choice:hover {
    background: #f8fafc;
}
.pcd-choice--selected {
    border-color: var(--pcd-primary);
    background: #f0f6ff;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}
.pcd-choice-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--pcd-text);
}
.pcd-choice-sub {
    font-size: 11.5px;
    color: #64748b;
}

.pcd-foot {
    padding: 14px 22px;
    background: #fbfbfd;
    border-top: 1px solid var(--pcd-border);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
.pcd-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 16px;
    border-radius: 7px;
    font: 500 13px var(--pcd-font-sans);
    cursor: pointer;
    border: 1px solid var(--pcd-border-strong);
    background: #fff;
    color: var(--pcd-text);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.pcd-btn:hover:not(:disabled) {
    background: #f8fafc;
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
    background: rgba(15, 23, 42, 0.05);
}
.pcd-btn--primary {
    background: var(--pcd-primary);
    border-color: var(--pcd-primary);
    color: #fff;
}
.pcd-btn--primary:hover:not(:disabled) {
    background: var(--pcd-primary-700);
}
.pcd-ico {
    display: inline-flex;
}

@media (max-width: 540px) {
    .pcd-row--2col,
    .pcd-choice-grid {
        grid-template-columns: 1fr;
    }
}
</style>
