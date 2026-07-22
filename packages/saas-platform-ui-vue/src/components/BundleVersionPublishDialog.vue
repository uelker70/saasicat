<template>
    <q-dialog v-model="open" persistent>
        <q-card style="min-width: 560px; max-width: 96vw">
            <q-card-section>
                <div class="text-h6">{{ msg.publishDialog.title }}</div>
                <p class="text-caption text-grey-7">
                    {{ msg.publishDialog.bundleLabel }} <code>{{ bundleKey }}</code> · v{{
                        draft.version
                    }}
                </p>
            </q-card-section>

            <q-card-section v-if="!previewLoaded" class="bvpd__loading">
                <q-spinner color="primary" size="32px" />
                <span class="q-ml-sm">{{ msg.publishDialog.loadingDiff }}</span>
            </q-card-section>

            <q-card-section v-else class="bvpd__body">
                <!-- Pre-emptive strict-mode warnings from the last mutate -->
                <q-banner v-if="warnings.length > 0" class="bvpd__warnings" inline-actions rounded>
                    <template #avatar>
                        <q-icon name="warning" color="warning" />
                    </template>
                    <strong>{{ strictWarningsText }}</strong>
                    <ul class="bvpd__list">
                        <li v-for="(w, i) in warnings" :key="i">
                            <code>{{ w.code }}</code>
                            <template v-if="w.value">
                                · <code>{{ w.value }}</code></template
                            >
                            — {{ w.message }}
                        </li>
                    </ul>
                </q-banner>

                <div class="bvpd__validity">
                    <div class="bvpd__label">{{ msg.fields.validity }}</div>
                    <div class="bvpd__validity-grid">
                        <label class="bvpd__field">
                            <span>{{ msg.fields.validFrom }}</span>
                            <input v-model="validFromInput" class="bvpd__input" type="date" />
                        </label>
                        <label class="bvpd__field">
                            <span>{{ msg.fields.validUntil }}</span>
                            <input v-model="validUntilInput" class="bvpd__input" type="date" />
                        </label>
                    </div>
                    <p v-if="validityError" class="bvpd__error">{{ validityError }}</p>
                </div>

                <div>
                    <q-toggle v-model="allowZeroPrice" :label="msg.publishDialog.allowZeroPrice" />
                    <p class="bvpd__label" style="margin-top: 6px">
                        {{ msg.publishDialog.allowZeroPriceHint }}
                    </p>
                </div>

                <!-- Diff against the previous version -->
                <div>
                    <div class="bvpd__label">
                        {{ msg.publishDialog.changesVs }}
                        <span v-if="previousVersion"> v{{ previousVersion }} </span>
                        <span v-else class="text-grey-7">
                            {{ msg.publishDialog.noPrevious }}
                        </span>
                    </div>
                    <q-banner
                        v-if="changes.length === 0 && previousVersion"
                        class="bvpd__neutral"
                        inline-actions
                        rounded
                    >
                        <template #avatar>
                            <q-icon name="info" color="grey-7" />
                        </template>
                        {{ msg.publishDialog.noChanges }}
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
                                    <span class="bvpd__old">{{ formatValue(c.oldValue) }}</span>
                                    <q-icon name="arrow_forward" size="14px" class="q-mx-xs" />
                                    <span class="bvpd__new">{{ formatValue(c.newValue) }}</span>
                                </q-item-label>
                            </q-item-section>
                        </q-item>
                    </q-list>
                </div>

                <!-- Regression warning -->
                <q-banner v-if="isRegression" class="bvpd__regression" inline-actions rounded>
                    <template #avatar>
                        <q-icon name="error" color="negative" />
                    </template>
                    <strong>{{ msg.publishDialog.regressionTitle }}</strong>
                    {{ msg.publishDialog.regressionBody }}
                    <code>force</code>{{ msg.publishDialog.regressionBodySuffix }}
                    <template #action>
                        <q-toggle
                            v-model="forceRegressive"
                            :label="msg.publishDialog.forceRegressive"
                            color="negative"
                        />
                    </template>
                </q-banner>
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat :label="common.cancel" @click="close" />
                <q-btn
                    unelevated
                    :color="isRegression ? 'negative' : 'positive'"
                    :label="
                        isRegression
                            ? msg.publishDialog.confirmRegressive
                            : msg.publishDialog.confirm
                    "
                    :loading="submitting"
                    :disable="!canSubmit"
                    @click="submit"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
    BundleVersionMutationResult,
    BundleVersionRow,
    StrictModeWarning,
    VersionChange,
} from '@saasicat/types';

import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

// BundleVersionPublishDialog — confirm modal for publishing a draft version.
// Shows the diff against the previous version (publishedChanges) and blocks
// regressive versions without a forceRegressive confirm.

const props = defineProps<{
    modelValue: boolean;
    bundleKey: string;
    draft: BundleVersionRow;
    /** Previous version (or null on first publication). */
    previous: BundleVersionRow | null;
    /** Pre-detected strict-mode warnings (e.g. from the last draft mutation). */
    warnings: StrictModeWarning[];
    /**
     * Pure-function diff classifier. The consumer wrapper passes the
     * appropriate `classifyBundleVersionDiff(...)` from the platform package
     * through — the UI does not depend directly on the NestJS implementation.
     */
    classifyDiff: (
        previous: BundleVersionRow,
        draft: BundleVersionRow,
    ) => { changes: VersionChange[]; nonRegressive: boolean };
    submit: (opts: {
        forceRegressive: boolean;
        allowZeroPrice?: boolean;
        validFrom?: string | null;
        validUntil?: string | null;
    }) => Promise<BundleVersionMutationResult>;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'submitted', result: BundleVersionMutationResult): void;
}>();

const msg = useSaMessages('bundles');
const common = useSaMessages('common');

const open = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

const previewLoaded = ref(false);
const changes = ref<VersionChange[]>([]);
const nonRegressive = ref(true);
const forceRegressive = ref(false);
const allowZeroPrice = ref(false);
const submitting = ref(false);
const validFromInput = ref('');
const validUntilInput = ref('');

const previousVersion = computed(() => props.previous?.version ?? null);
const isRegression = computed(() => previewLoaded.value && !nonRegressive.value);
const strictWarningsText = computed(() =>
    formatMessage(msg.value.publishDialog.strictWarnings, { count: props.warnings.length }),
);
const validityError = computed<string | null>(() => {
    if (!validFromInput.value) return msg.value.validation.validFromRequired;
    if (validUntilInput.value && validUntilInput.value <= validFromInput.value) {
        return msg.value.validation.validUntilAfterValidFrom;
    }
    return null;
});
const canSubmit = computed(
    () =>
        previewLoaded.value &&
        !submitting.value &&
        !validityError.value &&
        (!isRegression.value || forceRegressive.value),
);

watch(
    () => [props.modelValue, props.draft, props.previous],
    () => {
        if (!props.modelValue) return;
        previewLoaded.value = false;
        forceRegressive.value = false;
        allowZeroPrice.value = false;
        validFromInput.value = props.draft.validFrom ? props.draft.validFrom.slice(0, 10) : '';
        validUntilInput.value = props.draft.validUntil ? props.draft.validUntil.slice(0, 10) : '';
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
    if (!canSubmit.value) return;
    submitting.value = true;
    try {
        const result = await props.submit({
            forceRegressive: forceRegressive.value,
            allowZeroPrice: allowZeroPrice.value,
            validFrom: validFromInput.value || null,
            validUntil: validUntilInput.value || null,
        });
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
.bvpd__body {
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.bvpd__label {
    font-size: 12px;
    color: var(--q-grey-7, #757575);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}
.bvpd__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
}
.bvpd__warnings {
    border-left: 4px solid var(--q-warning, #f2c037);
}
.bvpd__neutral {
    border-left: 4px solid var(--q-grey-7, #757575);
}
.bvpd__regression {
    border-left: 4px solid var(--q-negative, #c10015);
}
.bvpd__validity {
    padding: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
}
.bvpd__validity-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}
.bvpd__field {
    display: grid;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #475569;
}
.bvpd__input {
    min-height: 36px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 0 10px;
    font: inherit;
    color: #0f172a;
    background: #fff;
}
.bvpd__error {
    margin: 8px 0 0;
    color: var(--q-negative, #c10015);
    font-size: 12px;
    font-weight: 700;
}
.bvpd__list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 13px;
}
.bvpd__old {
    color: var(--q-negative, #c10015);
    text-decoration: line-through;
}
.bvpd__new {
    color: var(--q-positive, #21ba45);
    font-weight: 600;
}
</style>
