<template>
    <q-dialog v-model="open" persistent>
        <q-card style="min-width: 720px; max-width: 96vw">
            <q-card-section>
                <div class="text-h6">
                    {{ mode === 'create' ? 'Neue BusinessTypeVersion' : 'Draft bearbeiten' }}
                </div>
                <p class="text-caption text-grey-7">
                    BusinessType <code>{{ businessTypeKey }}</code> · v{{ versionNumber }}
                    {{ mode === 'create' ? '(neu)' : '(Draft)' }}
                </p>
            </q-card-section>

            <q-card-section class="bvt__body">
                <!-- Bundle-Komposition -->
                <div>
                    <div class="bvt__label">Bundle-Komposition</div>
                    <p class="text-caption text-grey-7 q-mb-sm">
                        BusinessType referenziert konkrete <strong>published</strong>
                        BundleVersions. Reihenfolge bestimmt die Sortierung im UI.
                    </p>

                    <q-list bordered separator dense>
                        <q-item
                            v-for="(entry, idx) in form.bundles"
                            :key="`${entry.bundleVersionId}-${idx}`"
                        >
                            <q-item-section>
                                <q-select
                                    :model-value="entry.bundleVersionId"
                                    :options="bundleOptions"
                                    option-label="label"
                                    option-value="value"
                                    emit-value
                                    map-options
                                    outlined
                                    dense
                                    label="BundleVersion"
                                    @update:model-value="(v) => updateBundleAt(idx, String(v))"
                                />
                            </q-item-section>
                            <q-item-section side>
                                <q-btn
                                    flat
                                    dense
                                    round
                                    icon="arrow_upward"
                                    :disable="idx === 0"
                                    @click="moveBundle(idx, -1)"
                                />
                                <q-btn
                                    flat
                                    dense
                                    round
                                    icon="arrow_downward"
                                    :disable="idx === form.bundles.length - 1"
                                    @click="moveBundle(idx, 1)"
                                />
                                <q-btn
                                    flat
                                    dense
                                    round
                                    icon="delete"
                                    color="negative"
                                    @click="removeBundle(idx)"
                                />
                            </q-item-section>
                        </q-item>
                    </q-list>
                    <q-banner
                        v-if="form.bundles.length === 0"
                        class="bvt__warn"
                        inline-actions
                        rounded
                    >
                        <template #avatar>
                            <q-icon name="warning" color="warning" />
                        </template>
                        Mindestens ein Bundle muss referenziert werden, bevor die Version published
                        werden kann.
                    </q-banner>
                    <q-btn
                        flat
                        dense
                        icon="add"
                        label="Bundle ergänzen"
                        color="primary"
                        :disable="availableBundles.length === 0"
                        @click="addBundle"
                    />
                </div>

                <!-- Quota-Overrides -->
                <div>
                    <div class="bvt__label">Quota-Overrides</div>
                    <p class="text-caption text-grey-7 q-mb-sm">
                        Fehlender Key = Σ(Bundle-Quotas); gesetzter Key ersetzt die Summe (-1 =
                        unbegrenzt).
                    </p>
                    <div class="bvt__quotas">
                        <div
                            v-for="(_value, key) in form.quotaOverrides"
                            :key="key"
                            class="bvt__quota-row"
                        >
                            <q-input
                                :model-value="key"
                                outlined
                                dense
                                label="Key"
                                @update:model-value="(newKey) => renameQuota(key, String(newKey))"
                            />
                            <q-input
                                v-model.number="form.quotaOverrides[key]"
                                outlined
                                dense
                                type="number"
                                label="Wert"
                            />
                            <q-btn
                                flat
                                dense
                                round
                                icon="delete"
                                color="negative"
                                @click="removeQuota(String(key))"
                            />
                        </div>
                        <q-btn
                            flat
                            dense
                            icon="add"
                            label="Quota-Override ergänzen"
                            color="primary"
                            @click="addQuota"
                        />
                    </div>
                </div>

                <!-- Pricing -->
                <div class="bvt__pricing">
                    <q-input
                        v-model="form.monthlyNet"
                        outlined
                        dense
                        label="Monatspreis (Override, EUR)"
                        hint="leer = Σ(Bundle-Preise)"
                        clearable
                    />
                    <q-input
                        v-model="form.yearlyNet"
                        outlined
                        dense
                        label="Jahrespreis (Override, EUR)"
                        clearable
                    />
                </div>

                <q-toggle v-model="form.marketed" label="In Public-Catalog vermarkten" />

                <q-input
                    v-model="form.changeNote"
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    label="Change-Note"
                />

                <q-banner
                    v-if="lastWarnings.length > 0"
                    class="bvt__warnings"
                    inline-actions
                    rounded
                >
                    <template #avatar>
                        <q-icon name="warning" color="warning" />
                    </template>
                    <strong>{{ lastWarnings.length }} Strict-Mode-Warnung(en):</strong>
                    <ul class="bvt__warnings-list">
                        <li v-for="(w, i) in lastWarnings" :key="i">
                            <code>{{ w.code }}</code>
                            <template v-if="w.value">
                                · <code>{{ w.value }}</code></template
                            >
                            — {{ w.message }}
                        </li>
                    </ul>
                </q-banner>
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" @click="close" />
                <q-btn
                    unelevated
                    color="primary"
                    :label="mode === 'create' ? 'Anlegen' : 'Speichern'"
                    :disable="form.bundles.length === 0"
                    :loading="submitting"
                    @click="submit"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
    BundleVersionRow,
    BusinessTypeVersionMutationResult,
    BusinessTypeVersionRow,
    CreateBusinessTypeVersionDraftData,
    StrictModeWarning,
    UpdateBusinessTypeVersionDraftData,
} from '@saasicat/types';

interface FormState {
    bundles: Array<{ bundleVersionId: string; sortOrder: number }>;
    quotaOverrides: Record<string, number>;
    monthlyNet: string | null;
    yearlyNet: string | null;
    marketed: boolean;
    changeNote: string;
}

const props = defineProps<{
    modelValue: boolean;
    mode: 'create' | 'edit';
    businessTypeKey: string;
    draft?: BusinessTypeVersionRow | null;
    versionNumber: number;
    /**
     * Liste aller verfügbaren published BundleVersions im Projekt. Konsument-
     * Wrapper sammelt das aus useBundles + useBundleVersions.
     */
    availableBundles: BundleVersionRow[];
    submit: (
        data: CreateBusinessTypeVersionDraftData | UpdateBusinessTypeVersionDraftData,
    ) => Promise<BusinessTypeVersionMutationResult>;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'submitted', result: BusinessTypeVersionMutationResult): void;
}>();

const open = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

const form = ref<FormState>(buildInitialForm());
const submitting = ref(false);
const lastWarnings = ref<StrictModeWarning[]>([]);

const bundleOptions = computed(() =>
    props.availableBundles.map((bv) => ({
        value: bv.id,
        label: `${bv.bundleKey} · v${bv.version} (${bv.features.length} Features)`,
    })),
);

watch(
    () => [props.modelValue, props.draft],
    () => {
        if (props.modelValue) {
            form.value = buildInitialForm();
            lastWarnings.value = [];
        }
    },
    { immediate: true },
);

function buildInitialForm(): FormState {
    if (props.mode === 'edit' && props.draft) {
        return {
            bundles: props.draft.bundles.map((b) => ({
                bundleVersionId: b.bundleVersionId,
                sortOrder: b.sortOrder,
            })),
            quotaOverrides: { ...props.draft.quotaOverrides } as Record<string, number>,
            monthlyNet: props.draft.monthlyNet,
            yearlyNet: props.draft.yearlyNet,
            marketed: props.draft.marketed,
            changeNote: props.draft.changeNote,
        };
    }
    return {
        bundles: [],
        quotaOverrides: {},
        monthlyNet: null,
        yearlyNet: null,
        marketed: true,
        changeNote: '',
    };
}

function close(): void {
    open.value = false;
}

function addBundle(): void {
    const used = new Set(form.value.bundles.map((b) => b.bundleVersionId));
    const next = props.availableBundles.find((bv) => !used.has(bv.id));
    if (!next) return;
    form.value.bundles = [
        ...form.value.bundles,
        { bundleVersionId: next.id, sortOrder: form.value.bundles.length },
    ];
}

function updateBundleAt(idx: number, bundleVersionId: string): void {
    form.value.bundles = form.value.bundles.map((b, i) =>
        i === idx ? { ...b, bundleVersionId } : b,
    );
}

function removeBundle(idx: number): void {
    form.value.bundles = form.value.bundles
        .filter((_, i) => i !== idx)
        .map((b, i) => ({ ...b, sortOrder: i }));
}

function moveBundle(idx: number, delta: number): void {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= form.value.bundles.length) return;
    const next = [...form.value.bundles];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    form.value.bundles = next.map((b, i) => ({ ...b, sortOrder: i }));
}

function addQuota(): void {
    const newKey = `newQuota${Object.keys(form.value.quotaOverrides).length + 1}`;
    form.value.quotaOverrides = { ...form.value.quotaOverrides, [newKey]: 0 };
}

function removeQuota(key: string): void {
    const next = { ...form.value.quotaOverrides };
    delete next[key];
    form.value.quotaOverrides = next;
}

function renameQuota(oldKey: string | number, newKey: string): void {
    if (!newKey || newKey === oldKey) return;
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(form.value.quotaOverrides)) {
        next[k === String(oldKey) ? newKey : k] = v;
    }
    form.value.quotaOverrides = next;
}

async function submit(): Promise<void> {
    submitting.value = true;
    try {
        const payload = {
            bundles: form.value.bundles,
            quotaOverrides: form.value.quotaOverrides,
            monthlyNet: form.value.monthlyNet || null,
            yearlyNet: form.value.yearlyNet || null,
            marketed: form.value.marketed,
            changeNote: form.value.changeNote,
        };
        const result = await props.submit(payload);
        lastWarnings.value = result.warnings;
        emit('submitted', result);
        if (result.warnings.length === 0) {
            close();
        }
    } finally {
        submitting.value = false;
    }
}
</script>

<style scoped>
.bvt__body {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.bvt__label {
    font-size: 12px;
    color: var(--q-grey-7, #757575);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
}
.bvt__quotas {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.bvt__quota-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 8px;
    align-items: center;
}
.bvt__pricing {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}
.bvt__warn {
    border-left: 4px solid var(--q-warning, #f2c037);
    margin: 8px 0;
}
.bvt__warnings {
    border-left: 4px solid var(--q-warning, #f2c037);
}
.bvt__warnings-list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 13px;
}
</style>
