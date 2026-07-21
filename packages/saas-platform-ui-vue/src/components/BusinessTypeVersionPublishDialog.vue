<template>
    <q-dialog v-model="open" persistent>
        <q-card style="min-width: 600px; max-width: 96vw">
            <q-card-section>
                <div class="text-h6">BusinessTypeVersion publishen</div>
                <p class="text-caption text-grey-7">
                    BusinessType <code>{{ businessTypeKey }}</code> · v{{ draft.version }}
                </p>
            </q-card-section>

            <q-card-section v-if="!previewLoaded" class="bvtp__loading">
                <q-spinner color="primary" size="32px" />
                <span class="q-ml-sm">Diff wird geladen …</span>
            </q-card-section>

            <q-card-section v-else class="bvtp__body">
                <q-banner v-if="warnings.length > 0" class="bvtp__warnings" inline-actions rounded>
                    <template #avatar>
                        <q-icon name="warning" color="warning" />
                    </template>
                    <strong>{{ warnings.length }} Strict-Mode-Warnung(en)</strong>
                    <ul class="bvtp__list">
                        <li v-for="(w, i) in warnings" :key="i">
                            <code>{{ w.code }}</code>
                            <template v-if="w.value">
                                · <code>{{ w.value }}</code></template
                            >
                            — {{ w.message }}
                        </li>
                    </ul>
                </q-banner>

                <div>
                    <div class="bvtp__label">
                        Änderungen gegenüber
                        <span v-if="previousVersion">v{{ previousVersion }}</span>
                        <span v-else class="text-grey-7">
                            — keine Vorgänger-Version (Erst-Veröffentlichung)
                        </span>
                    </div>
                    <q-banner
                        v-if="changes.length === 0 && previousVersion"
                        class="bvtp__neutral"
                        inline-actions
                        rounded
                    >
                        <template #avatar>
                            <q-icon name="info" color="grey-7" />
                        </template>
                        Keine Änderungen — die Versionen sind inhaltlich gleich.
                    </q-banner>
                    <q-list v-else-if="changes.length > 0" bordered separator>
                        <q-item v-for="(c, i) in changes" :key="i">
                            <q-item-section side>
                                <q-chip
                                    dense
                                    :color="directionColor(c.direction)"
                                    text-color="white"
                                >
                                    {{ directionLabel(c.direction) }}
                                </q-chip>
                            </q-item-section>
                            <q-item-section>
                                <q-item-label>
                                    <code>{{ c.field }}</code>
                                </q-item-label>
                                <q-item-label caption>
                                    <span class="bvtp__old">{{ formatValue(c.oldValue) }}</span>
                                    <q-icon name="arrow_forward" size="14px" class="q-mx-xs" />
                                    <span class="bvtp__new">{{ formatValue(c.newValue) }}</span>
                                </q-item-label>
                            </q-item-section>
                        </q-item>
                    </q-list>
                </div>

                <q-banner v-if="isRegression" class="bvtp__regression" inline-actions rounded>
                    <template #avatar>
                        <q-icon name="error" color="negative" />
                    </template>
                    <strong>Regressive Änderung erkannt.</strong>
                    Diese Version entfernt Bundles, senkt Quota-Overrides oder erhöht Preise.
                    Vertragsschutz P3 verlangt Bestand-Opt-in.
                    <template #action>
                        <q-toggle
                            v-model="forceRegressive"
                            label="Trotzdem publishen"
                            color="negative"
                        />
                    </template>
                </q-banner>
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" @click="close" />
                <q-btn
                    unelevated
                    :color="isRegression ? 'negative' : 'positive'"
                    :label="isRegression ? 'Regressiv publishen' : 'Publishen'"
                    :loading="submitting"
                    :disable="isRegression && !forceRegressive"
                    @click="submit"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
    BusinessTypeVersionMutationResult,
    BusinessTypeVersionRow,
    StrictModeWarning,
    VersionChange,
} from '@saasicat/types';

const props = defineProps<{
    modelValue: boolean;
    businessTypeKey: string;
    draft: BusinessTypeVersionRow;
    previous: BusinessTypeVersionRow | null;
    warnings: StrictModeWarning[];
    /**
     * Pure-function diff classifier for BusinessTypeVersion. The consumer
     * wrapper imports `classifyBusinessTypeVersionDiff` from
     * `@saasicat/types` and passes it through.
     */
    classifyDiff: (
        previous: BusinessTypeVersionRow,
        draft: BusinessTypeVersionRow,
    ) => { changes: VersionChange[]; nonRegressive: boolean };
    submit: (opts: { forceRegressive: boolean }) => Promise<BusinessTypeVersionMutationResult>;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'submitted', result: BusinessTypeVersionMutationResult): void;
}>();

const open = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

const previewLoaded = ref(false);
const changes = ref<VersionChange[]>([]);
const nonRegressive = ref(true);
const forceRegressive = ref(false);
const submitting = ref(false);

const previousVersion = computed(() => props.previous?.version ?? null);
const isRegression = computed(() => previewLoaded.value && !nonRegressive.value);

watch(
    () => [props.modelValue, props.draft, props.previous],
    () => {
        if (!props.modelValue) return;
        previewLoaded.value = false;
        forceRegressive.value = false;
        try {
            const diff = props.previous
                ? props.classifyDiff(props.previous, props.draft)
                : { changes: [], nonRegressive: true };
            changes.value = diff.changes;
            nonRegressive.value = diff.nonRegressive;
        } finally {
            previewLoaded.value = true;
        }
    },
    { immediate: true },
);

function close(): void {
    open.value = false;
}

async function submit(): Promise<void> {
    submitting.value = true;
    try {
        const result = await props.submit({ forceRegressive: forceRegressive.value });
        emit('submitted', result);
        close();
    } finally {
        submitting.value = false;
    }
}

function directionColor(d: VersionChange['direction']): string {
    switch (d) {
        case 'IMPROVEMENT':
            return 'positive';
        case 'REGRESSION':
            return 'negative';
        default:
            return 'grey-7';
    }
}
function directionLabel(d: VersionChange['direction']): string {
    switch (d) {
        case 'IMPROVEMENT':
            return '+';
        case 'REGRESSION':
            return '−';
        default:
            return '○';
    }
}
function formatValue(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.length === 0 ? '[]' : v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}
</script>

<style scoped>
.bvtp__body {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.bvtp__label {
    font-size: 12px;
    color: var(--q-grey-7, #757575);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}
.bvtp__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
}
.bvtp__warnings {
    border-left: 4px solid var(--q-warning, #f2c037);
}
.bvtp__neutral {
    border-left: 4px solid var(--q-grey-7, #757575);
}
.bvtp__regression {
    border-left: 4px solid var(--q-negative, #c10015);
}
.bvtp__list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 13px;
}
.bvtp__old {
    color: var(--q-negative, #c10015);
    text-decoration: line-through;
}
.bvtp__new {
    color: var(--q-positive, #21ba45);
    font-weight: 600;
}
</style>
