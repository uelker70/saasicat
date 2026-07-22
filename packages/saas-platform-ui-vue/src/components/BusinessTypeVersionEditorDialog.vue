<template>
    <q-dialog v-model="open" persistent>
        <q-card style="min-width: 720px; max-width: 96vw">
            <q-card-section>
                <div class="text-h6">
                    {{ mode === 'create' ? msg.editor.titleCreate : msg.editor.titleEdit }}
                </div>
                <p class="text-caption text-grey-7">
                    {{ msg.businessTypeLabel }} <code>{{ businessTypeKey }}</code> · v{{
                        versionNumber
                    }}
                    {{ mode === 'create' ? msg.editor.modeNew : msg.editor.modeDraft }}
                </p>
            </q-card-section>

            <q-card-section class="bvt__body">
                <!-- Bundle composition -->
                <div>
                    <div class="bvt__label">{{ msg.editor.bundleComposition }}</div>
                    <p class="text-caption text-grey-7 q-mb-sm">
                        {{ msg.editor.bundleHintBefore }} <strong>published</strong>
                        {{ msg.editor.bundleHintAfter }}
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
                                    :label="msg.editor.bundleVersion"
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
                        {{ msg.editor.noBundlesWarning }}
                    </q-banner>
                    <q-btn
                        flat
                        dense
                        icon="add"
                        :label="msg.editor.addBundle"
                        color="primary"
                        :disable="availableBundles.length === 0"
                        @click="addBundle"
                    />
                </div>

                <!-- Quota overrides -->
                <div>
                    <div class="bvt__label">{{ msg.editor.quotaOverrides }}</div>
                    <p class="text-caption text-grey-7 q-mb-sm">{{ msg.editor.quotaHint }}</p>
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
                                :label="msg.keyLabel"
                                @update:model-value="(newKey) => renameQuota(key, String(newKey))"
                            />
                            <q-input
                                v-model.number="form.quotaOverrides[key]"
                                outlined
                                dense
                                type="number"
                                :label="msg.editor.quotaValue"
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
                            :label="msg.editor.addQuotaOverride"
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
                        :label="msg.editor.monthlyNet"
                        :hint="msg.editor.monthlyNetHint"
                        clearable
                    />
                    <q-input
                        v-model="form.yearlyNet"
                        outlined
                        dense
                        :label="msg.editor.yearlyNet"
                        clearable
                    />
                </div>

                <q-toggle v-model="form.marketed" :label="msg.editor.marketed" />

                <q-input
                    v-model="form.changeNote"
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    :label="msg.editor.changeNote"
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
                    <strong>{{ strictWarningsLabel }}:</strong>
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
                <q-btn flat :label="common.cancel" @click="close" />
                <q-btn
                    unelevated
                    color="primary"
                    :label="mode === 'create' ? common.create : common.save"
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
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

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
     * List of all available published BundleVersions in the project. The consumer
     * wrapper collects this from useBundles + useBundleVersions.
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

const msg = useSaMessages('businessTypes');
const common = useSaMessages('common');

const open = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

const form = ref<FormState>(buildInitialForm());
const submitting = ref(false);
const lastWarnings = ref<StrictModeWarning[]>([]);

const strictWarningsLabel = computed(() =>
    formatMessage(msg.value.strictWarnings, { count: lastWarnings.value.length }),
);

const bundleOptions = computed(() =>
    props.availableBundles.map((bv) => ({
        value: bv.id,
        label: formatMessage(msg.value.editor.bundleOption, {
            key: bv.bundleKey,
            version: bv.version,
            count: bv.features.length,
        }),
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
