<template>
    <div class="sa-bts">
        <header class="sa-bts__head">
            <div>
                <h1 class="sa-bts__title">BusinessTypes</h1>
                <p class="sa-bts__sub">
                    {{ businessTypes.length }} BusinessType{{
                        businessTypes.length === 1 ? '' : 's'
                    }}
                    · Projekt {{ projectKey }}
                </p>
            </div>
            <div class="sa-bts__head-actions">
                <q-btn
                    unelevated
                    color="primary"
                    icon="add"
                    label="Neuer BusinessType"
                    @click="openCreateDialog"
                />
                <q-btn flat icon="refresh" :loading="loading" @click="load" />
            </div>
        </header>

        <q-banner v-if="error" class="sa-bts__error" inline-actions rounded>
            <template #avatar><q-icon name="warning" color="negative" /></template>
            Fehler beim Laden: {{ error.message }}
        </q-banner>

        <q-banner
            v-if="businessTypes.length === 0 && !loading && !error"
            class="sa-bts__empty"
            inline-actions
            rounded
        >
            <template #avatar><q-icon name="info" color="info" /></template>
            Noch keine BusinessTypes angelegt. BusinessTypes komponieren mehrere published
            BundleVersions zu einer fachlichen Vertikale (z. B. Vereinstyp).
        </q-banner>

        <div v-if="businessTypes.length > 0" class="sa-bts__card">
            <q-table
                flat
                :rows="businessTypes"
                :columns="columns"
                row-key="id"
                :pagination="{ rowsPerPage: 0 }"
                hide-pagination
                @row-click="(_, row) => openDetail(row)"
            >
                <template #body-cell-businessTypeKey="{ row }">
                    <q-td>
                        <code class="sa-bts__key">{{ row.businessTypeKey }}</code>
                    </q-td>
                </template>
                <template #body-cell-actions="{ row }">
                    <q-td>
                        <q-btn
                            flat
                            dense
                            icon="edit"
                            color="primary"
                            @click.stop="openDetail(row)"
                        />
                        <q-btn
                            flat
                            dense
                            icon="delete"
                            color="negative"
                            @click.stop="confirmDelete(row)"
                        />
                    </q-td>
                </template>
            </q-table>
        </div>

        <!-- Create-Dialog -->
        <q-dialog v-model="createOpen">
            <q-card style="min-width: 480px; max-width: 96vw">
                <q-card-section>
                    <div class="text-h6">Neuer BusinessType</div>
                </q-card-section>
                <q-card-section class="sa-bts__form">
                    <q-input
                        v-model="createForm.businessTypeKey"
                        outlined
                        dense
                        label="BusinessType-Key (SCREAMING_SNAKE_CASE)"
                    />
                    <q-input v-model="createForm.label" outlined dense label="Label" />
                    <q-input
                        v-model="createForm.description"
                        outlined
                        dense
                        type="textarea"
                        autogrow
                        label="Beschreibung"
                    />
                    <q-input v-model="createForm.icon" outlined dense label="Icon (optional)" />
                    <q-input
                        v-model.number="createForm.sortOrder"
                        outlined
                        dense
                        type="number"
                        label="Sortier-Reihenfolge"
                    />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn v-close-popup flat label="Abbrechen" />
                    <q-btn
                        unelevated
                        color="primary"
                        label="Anlegen"
                        :loading="createSubmitting"
                        :disable="!canSubmitCreate"
                        @click="submitCreate"
                    />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- Detail-Drawer -->
        <q-drawer v-model="detailOpen" side="right" :width="560" bordered overlay>
            <div v-if="detailType" class="sa-bts__drawer">
                <header class="sa-bts__drawer-head">
                    <div>
                        <code class="sa-bts__key">{{ detailType.businessTypeKey }}</code>
                        <h2 class="sa-bts__drawer-title">{{ detailType.label }}</h2>
                    </div>
                    <q-btn flat dense icon="close" @click="detailOpen = false" />
                </header>

                <section class="sa-bts__form">
                    <q-input v-model="editForm.label" outlined dense label="Label" />
                    <q-input
                        v-model="editForm.description"
                        outlined
                        dense
                        type="textarea"
                        autogrow
                        label="Beschreibung"
                    />
                    <q-input v-model="editForm.icon" outlined dense label="Icon" />
                    <q-input
                        v-model.number="editForm.sortOrder"
                        outlined
                        dense
                        type="number"
                        label="Sortier-Reihenfolge"
                    />
                    <q-btn
                        unelevated
                        color="primary"
                        label="Speichern"
                        :loading="editSubmitting"
                        @click="submitEdit"
                    />
                </section>

                <q-separator class="q-my-md" />

                <section>
                    <div class="sa-bts__drawer-subhead">
                        <strong>Versionen</strong>
                        <span class="text-caption text-grey-7">
                            {{ detailVersions.length }}
                        </span>
                    </div>
                    <q-banner
                        v-if="detailVersions.length === 0"
                        class="sa-bts__empty"
                        inline-actions
                        rounded
                    >
                        Noch keine Version. „Neuer Draft" anlegen.
                    </q-banner>
                    <q-list v-else bordered separator>
                        <q-item v-for="v in detailVersions" :key="v.id">
                            <q-item-section>
                                <q-item-label>v{{ v.version }}</q-item-label>
                                <q-item-label caption>
                                    {{ v.bundles.length }} Bundle{{
                                        v.bundles.length === 1 ? '' : 's'
                                    }}
                                    · {{ v.monthlyNet ?? 'Σ Bundle-Preise' }}
                                </q-item-label>
                            </q-item-section>
                            <q-item-section side>
                                <div class="sa-bts__version-actions">
                                    <q-chip dense :color="versionStatusColor(v)" text-color="white">
                                        {{ versionStatusLabel(v) }}
                                    </q-chip>
                                    <q-btn
                                        v-if="v.publishedAt === null"
                                        flat
                                        dense
                                        icon="edit"
                                        color="primary"
                                        @click="openEditDraft(v)"
                                    />
                                    <q-btn
                                        v-if="v.publishedAt === null"
                                        flat
                                        dense
                                        icon="rocket_launch"
                                        color="positive"
                                        @click="openPublish(v)"
                                    />
                                </div>
                            </q-item-section>
                        </q-item>
                    </q-list>

                    <div v-if="!hasDraft && detailType" class="sa-bts__new-draft">
                        <q-btn
                            unelevated
                            color="primary"
                            icon="add"
                            label="Neuer Draft"
                            @click="openCreateDraft"
                        />
                    </div>
                    <q-banner v-else-if="hasDraft" class="sa-bts__hint" inline-actions rounded>
                        Hat bereits eine Draft-Version.
                    </q-banner>
                </section>
            </div>
        </q-drawer>

        <!-- Strict-Mode-Warnings -->
        <q-banner
            v-if="lastWarnings.length > 0"
            class="sa-bts__warnings-banner"
            inline-actions
            rounded
        >
            <template #avatar><q-icon name="warning" color="warning" /></template>
            <strong>{{ lastWarnings.length }} Strict-Mode-Warnung(en) bei letzter Operation</strong>
            <ul class="sa-bts__warnings-list">
                <li v-for="(w, i) in lastWarnings" :key="i">
                    <code>{{ w.code }}</code>
                    <template v-if="w.value">
                        · <code>{{ w.value }}</code></template
                    >
                    — {{ w.message }}
                </li>
            </ul>
            <template #action>
                <q-btn flat dense label="Schließen" @click="lastWarnings = []" />
            </template>
        </q-banner>

        <!-- Editor + Publish-Dialoge -->
        <BusinessTypeVersionEditorDialog
            v-if="detailType && editorOpen"
            v-model="editorOpen"
            :mode="editorMode"
            :business-type-key="detailType.businessTypeKey"
            :draft="editorDraft"
            :version-number="editorVersionNumber"
            :available-bundles="availableBundles"
            :submit="onEditorSubmit"
            @submitted="onEditorSubmitted"
        />
        <BusinessTypeVersionPublishDialog
            v-if="detailType && publishOpen && publishDraft"
            v-model="publishOpen"
            :business-type-key="detailType.businessTypeKey"
            :draft="publishDraft"
            :previous="publishPrevious"
            :warnings="lastWarnings"
            :classify-diff="classifyDiff"
            :submit="onPublishSubmit"
            @submitted="onPublishSubmitted"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
    BundleVersionRow,
    BusinessTypeRow,
    BusinessTypeVersionMutationResult,
    BusinessTypeVersionRow,
    CreateBusinessTypeData,
    CreateBusinessTypeVersionDraftData,
    StrictModeWarning,
    UpdateBusinessTypeData,
    UpdateBusinessTypeVersionDraftData,
    VersionChange,
} from '@saasicat/types';

import BusinessTypeVersionEditorDialog from '../components/BusinessTypeVersionEditorDialog.vue';
import BusinessTypeVersionPublishDialog from '../components/BusinessTypeVersionPublishDialog.vue';

interface QTableColumn {
    name: string;
    label: string;
    field: string | ((row: unknown) => unknown);
    align?: 'left' | 'right' | 'center';
    sortable?: boolean;
}

const props = defineProps<{
    projectKey: string;
    businessTypes: BusinessTypeRow[];
    loading: boolean;
    error: Error | null;
    load: () => Promise<void>;
    create: (data: CreateBusinessTypeData) => Promise<BusinessTypeRow>;
    update: (businessTypeId: string, data: UpdateBusinessTypeData) => Promise<BusinessTypeRow>;
    softDelete: (businessTypeId: string) => Promise<void>;
    loadVersions: (businessTypeId: string) => Promise<BusinessTypeVersionRow[]>;
    createDraft: (
        businessTypeId: string,
        data: Omit<CreateBusinessTypeVersionDraftData, 'businessTypeId'>,
    ) => Promise<BusinessTypeVersionMutationResult>;
    updateDraft: (
        versionId: string,
        data: UpdateBusinessTypeVersionDraftData,
    ) => Promise<BusinessTypeVersionMutationResult>;
    publish: (
        versionId: string,
        opts: { forceRegressive?: boolean },
    ) => Promise<BusinessTypeVersionMutationResult>;
    /** Liste aller verfügbaren published BundleVersions im Projekt. */
    availableBundles: BundleVersionRow[];
    /** Pure-Function-Diff-Klassifikator. */
    classifyDiff: (
        previous: BusinessTypeVersionRow,
        draft: BusinessTypeVersionRow,
    ) => { changes: VersionChange[]; nonRegressive: boolean };
}>();

const columns: QTableColumn[] = [
    {
        name: 'businessTypeKey',
        label: 'Key',
        field: 'businessTypeKey',
        align: 'left',
        sortable: true,
    },
    { name: 'label', label: 'Label', field: 'label', align: 'left', sortable: true },
    {
        name: 'description',
        label: 'Beschreibung',
        field: (row) => (row as BusinessTypeRow).description ?? '—',
        align: 'left',
    },
    {
        name: 'sortOrder',
        label: 'Sort',
        field: 'sortOrder',
        align: 'right',
        sortable: true,
    },
    { name: 'actions', label: '', field: () => '', align: 'right' },
];

// ─── Create-Dialog ───
const createOpen = ref(false);
const createSubmitting = ref(false);
const createForm = ref<{
    businessTypeKey: string;
    label: string;
    description: string;
    icon: string;
    sortOrder: number;
}>({
    businessTypeKey: '',
    label: '',
    description: '',
    icon: '',
    sortOrder: 0,
});

const canSubmitCreate = computed(
    () => createForm.value.businessTypeKey.length > 0 && createForm.value.label.length > 0,
);

function openCreateDialog(): void {
    createForm.value = {
        businessTypeKey: '',
        label: '',
        description: '',
        icon: '',
        sortOrder: 0,
    };
    createOpen.value = true;
}

async function submitCreate(): Promise<void> {
    createSubmitting.value = true;
    try {
        await props.create({
            projectKey: props.projectKey,
            businessTypeKey: createForm.value.businessTypeKey,
            label: createForm.value.label,
            description: createForm.value.description || undefined,
            icon: createForm.value.icon || undefined,
            sortOrder: createForm.value.sortOrder,
        });
        createOpen.value = false;
    } finally {
        createSubmitting.value = false;
    }
}

// ─── Detail-Drawer ───
const detailOpen = ref(false);
const detailType = ref<BusinessTypeRow | null>(null);
const detailVersions = ref<BusinessTypeVersionRow[]>([]);
const editForm = ref<UpdateBusinessTypeData>({
    label: '',
    description: '',
    icon: '',
    sortOrder: 0,
});
const editSubmitting = ref(false);

async function openDetail(bt: BusinessTypeRow): Promise<void> {
    detailType.value = bt;
    editForm.value = {
        label: bt.label,
        description: bt.description ?? '',
        icon: bt.icon ?? '',
        sortOrder: bt.sortOrder,
    };
    detailOpen.value = true;
    detailVersions.value = await props.loadVersions(bt.id);
}

async function submitEdit(): Promise<void> {
    if (!detailType.value) return;
    editSubmitting.value = true;
    try {
        const updated = await props.update(detailType.value.id, {
            label: editForm.value.label,
            description: editForm.value.description || null,
            icon: editForm.value.icon || null,
            sortOrder: editForm.value.sortOrder,
        });
        detailType.value = updated;
    } finally {
        editSubmitting.value = false;
    }
}

async function confirmDelete(bt: BusinessTypeRow): Promise<void> {
    const ok = window.confirm(`BusinessType '${bt.businessTypeKey}' wirklich soft-deleten?`);
    if (!ok) return;
    await props.softDelete(bt.id);
    if (detailType.value?.id === bt.id) {
        detailOpen.value = false;
        detailType.value = null;
    }
}

watch(
    () => props.businessTypes,
    (next) => {
        if (detailType.value && !next.some((b) => b.id === detailType.value!.id)) {
            detailOpen.value = false;
            detailType.value = null;
        }
    },
);

// ─── Strict-Mode-Warnings ───
const lastWarnings = ref<StrictModeWarning[]>([]);

// ─── Editor-Modal ───
const editorOpen = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editorDraft = ref<BusinessTypeVersionRow | null>(null);

const hasDraft = computed(() => detailVersions.value.some((v) => v.publishedAt === null));

const editorVersionNumber = computed(() => {
    if (editorMode.value === 'edit' && editorDraft.value) return editorDraft.value.version;
    if (detailVersions.value.length === 0) return 1;
    return Math.max(...detailVersions.value.map((v) => v.version)) + 1;
});

function openCreateDraft(): void {
    if (hasDraft.value) return;
    editorMode.value = 'create';
    editorDraft.value = null;
    editorOpen.value = true;
}

function openEditDraft(v: BusinessTypeVersionRow): void {
    if (v.publishedAt !== null) return;
    editorMode.value = 'edit';
    editorDraft.value = v;
    editorOpen.value = true;
}

async function onEditorSubmit(
    data: CreateBusinessTypeVersionDraftData | UpdateBusinessTypeVersionDraftData,
): Promise<BusinessTypeVersionMutationResult> {
    if (editorMode.value === 'create' && detailType.value) {
        return props.createDraft(detailType.value.id, data as CreateBusinessTypeVersionDraftData);
    }
    if (editorMode.value === 'edit' && editorDraft.value) {
        return props.updateDraft(editorDraft.value.id, data as UpdateBusinessTypeVersionDraftData);
    }
    throw new Error('BusinessTypesPage: editor submit ohne Kontext');
}

async function onEditorSubmitted(result: BusinessTypeVersionMutationResult): Promise<void> {
    lastWarnings.value = result.warnings;
    if (detailType.value) {
        detailVersions.value = await props.loadVersions(detailType.value.id);
    }
}

// ─── Publish-Modal ───
const publishOpen = ref(false);
const publishDraft = ref<BusinessTypeVersionRow | null>(null);

const publishPrevious = computed<BusinessTypeVersionRow | null>(() => {
    if (!publishDraft.value) return null;
    return (
        detailVersions.value
            .filter((v) => v.publishedAt !== null && v.supersededAt === null)
            .sort((a, b) => b.version - a.version)[0] ?? null
    );
});

function openPublish(v: BusinessTypeVersionRow): void {
    if (v.publishedAt !== null) return;
    publishDraft.value = v;
    publishOpen.value = true;
}

async function onPublishSubmit(opts: {
    forceRegressive: boolean;
}): Promise<BusinessTypeVersionMutationResult> {
    if (!publishDraft.value) {
        throw new Error('BusinessTypesPage: publish submit ohne Draft');
    }
    return props.publish(publishDraft.value.id, opts);
}

async function onPublishSubmitted(result: BusinessTypeVersionMutationResult): Promise<void> {
    lastWarnings.value = result.warnings;
    publishDraft.value = null;
    if (detailType.value) {
        detailVersions.value = await props.loadVersions(detailType.value.id);
    }
}

function versionStatusLabel(v: BusinessTypeVersionRow): string {
    if (v.publishedAt === null) return 'Draft';
    if (v.supersededAt !== null) return 'Superseded';
    return v.marketed ? 'Live · marketed' : 'Live · intern';
}

function versionStatusColor(v: BusinessTypeVersionRow): string {
    if (v.publishedAt === null) return 'warning';
    if (v.supersededAt !== null) return 'grey';
    return v.marketed ? 'positive' : 'info';
}
</script>

<style scoped>
.sa-bts {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.sa-bts__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
}
.sa-bts__title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
}
.sa-bts__sub {
    margin: 4px 0 0;
    color: var(--q-grey-7, #757575);
    font-size: 12px;
}
.sa-bts__head-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}
.sa-bts__error {
    border-left: 4px solid var(--q-negative, #c10015);
}
.sa-bts__empty {
    border-left: 4px solid var(--q-info, #31ccec);
}
.sa-bts__card {
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.sa-bts__key {
    background: rgba(0, 0, 0, 0.05);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
}
.sa-bts__form {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.sa-bts__drawer {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.sa-bts__drawer-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
}
.sa-bts__drawer-title {
    font-size: 18px;
    font-weight: 600;
    margin: 4px 0 0;
}
.sa-bts__drawer-subhead {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
}
.sa-bts__version-actions {
    display: flex;
    align-items: center;
    gap: 4px;
}
.sa-bts__new-draft {
    margin-top: 12px;
}
.sa-bts__hint {
    border-left: 4px solid var(--q-info, #31ccec);
    margin-top: 12px;
}
.sa-bts__warnings-banner {
    border-left: 4px solid var(--q-warning, #f2c037);
}
.sa-bts__warnings-list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 13px;
}
</style>
