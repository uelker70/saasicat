<template>
    <q-page class="q-pa-md">
        <div class="notes-container">
            <!-- Plan + notesMax usage (from useEntitlement) -->
            <q-card flat bordered class="q-mb-md">
                <q-card-section class="row items-center justify-between">
                    <div>
                        <div class="text-overline text-grey-7">Current plan</div>
                        <div class="text-h6">{{ planName }}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-overline text-grey-7">Notes used</div>
                        <div class="text-h6">{{ usageLabel }}</div>
                    </div>
                </q-card-section>
                <q-linear-progress
                    v-if="notesMax > 0"
                    :value="usageRatio"
                    :color="usageColor"
                    size="6px"
                />
            </q-card>

            <!-- Create form -->
            <q-card flat bordered class="q-mb-md">
                <q-card-section>
                    <div class="text-subtitle1 q-mb-sm">New note</div>
                    <q-form @submit.prevent="onCreate">
                        <q-input
                            v-model="title"
                            label="Title"
                            :disable="creating"
                            :rules="[(v) => !!(v && v.trim()) || 'Title is required']"
                        />
                        <q-input
                            v-model="body"
                            label="Body (optional)"
                            type="textarea"
                            autogrow
                            :disable="creating"
                        />

                        <q-banner
                            v-if="quotaMessage"
                            dense
                            rounded
                            class="bg-orange-1 text-orange-9 q-mt-md"
                        >
                            <template #avatar>
                                <q-icon name="lock" color="orange-9" />
                            </template>
                            {{ quotaMessage }}
                            <template #action>
                                <q-btn
                                    flat
                                    dense
                                    color="orange-9"
                                    label="Upgrade plan"
                                    to="/plan"
                                />
                            </template>
                        </q-banner>

                        <q-btn
                            type="submit"
                            color="primary"
                            label="Add note"
                            unelevated
                            class="q-mt-md"
                            :loading="creating"
                        />
                    </q-form>
                </q-card-section>
            </q-card>

            <!-- Notes list + gated export -->
            <q-card flat bordered>
                <q-card-section class="row items-center justify-between">
                    <div class="text-subtitle1">Your notes</div>

                    <FeatureGate :feature="FEATURE_NOTES_EXPORT">
                        <q-btn
                            color="secondary"
                            icon="file_download"
                            label="Export"
                            unelevated
                            :loading="exporting"
                            @click="onExport"
                        />
                        <template #fallback>
                            <div class="row items-center q-gutter-sm">
                                <q-btn color="grey-6" icon="lock" label="Export" outline disable />
                                <div class="text-caption text-grey-7">
                                    Export is a Pro feature.
                                    <router-link to="/plan" class="upsell-link"
                                        >Upgrade</router-link
                                    >
                                </div>
                            </div>
                        </template>
                    </FeatureGate>
                </q-card-section>

                <q-separator />

                <div class="notes-list-wrap">
                    <q-inner-loading :showing="loading" />

                    <q-list v-if="notes.length" separator>
                        <q-item v-for="note in notes" :key="note.id">
                            <q-item-section>
                                <q-item-label>{{ note.title }}</q-item-label>
                                <q-item-label v-if="note.body" caption lines="2">
                                    {{ note.body }}
                                </q-item-label>
                            </q-item-section>
                            <q-item-section side top>
                                <q-item-label caption>{{
                                    formatDate(note.createdAt)
                                }}</q-item-label>
                            </q-item-section>
                        </q-item>
                    </q-list>

                    <q-card-section v-else-if="!loading" class="text-center text-grey-6">
                        No notes yet — create your first one above.
                    </q-card-section>
                </div>
            </q-card>
        </div>
    </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import FeatureGate from '@saasicat/ui-vue/components/FeatureGate.vue';
import { useInjectedEntitlement } from '@saasicat/ui-vue';
import { FEATURE_NOTES_EXPORT, QUOTA_NOTES_MAX } from '../labels';
import {
    QuotaExceededError,
    createNote,
    exportNotes,
    listNotes,
    type Note,
} from '../services/notes';

const $q = useQuasar();
const ent = useInjectedEntitlement();

const notes = ref<Note[]>([]);
const loading = ref(false);
const creating = ref(false);
const exporting = ref(false);
const title = ref('');
const body = ref('');
const quotaMessage = ref<string | null>(null);

const planName = computed(() => ent?.entitlement.value?.plan ?? '—');
const notesMax = computed(() => ent?.entitlement.value?.quotas?.[QUOTA_NOTES_MAX] ?? 0);
const usageLabel = computed(() =>
    notesMax.value > 0 ? `${notes.value.length} / ${notesMax.value}` : String(notes.value.length),
);
const usageRatio = computed(() =>
    notesMax.value > 0 ? Math.min(notes.value.length / notesMax.value, 1) : 0,
);
const usageColor = computed(() => {
    if (usageRatio.value >= 1) return 'negative';
    if (usageRatio.value >= 0.8) return 'warning';
    return 'primary';
});

async function refresh(): Promise<void> {
    loading.value = true;
    try {
        notes.value = await listNotes();
    } catch (err) {
        $q.notify({ type: 'negative', message: messageOf(err) });
    } finally {
        loading.value = false;
    }
}

async function onCreate(): Promise<void> {
    const t = title.value.trim();
    if (!t) return;
    creating.value = true;
    quotaMessage.value = null;
    try {
        const note = await createNote({ title: t, body: body.value.trim() || undefined });
        notes.value = [note, ...notes.value];
        title.value = '';
        body.value = '';
        $q.notify({ type: 'positive', message: 'Note created.' });
    } catch (err) {
        if (err instanceof QuotaExceededError) {
            quotaMessage.value = `Note limit reached (${err.used}/${err.max}). Upgrade your plan to add more.`;
        } else {
            $q.notify({ type: 'negative', message: messageOf(err) });
        }
    } finally {
        creating.value = false;
    }
}

async function onExport(): Promise<void> {
    exporting.value = true;
    try {
        const payload = await exportNotes();
        downloadJson(payload, `notes-${planName.value.toLowerCase()}.json`);
        $q.notify({ type: 'positive', message: `Exported ${payload.count} notes.` });
    } catch (err) {
        $q.notify({ type: 'negative', message: messageOf(err) });
    } finally {
        exporting.value = false;
    }
}

function downloadJson(data: unknown, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

onMounted(refresh);
</script>

<style scoped>
.notes-container {
    max-width: 760px;
    margin: 0 auto;
}
.notes-list-wrap {
    position: relative;
    min-height: 80px;
}
.upsell-link {
    color: var(--q-primary);
    font-weight: 600;
    text-decoration: none;
}
.upsell-link:hover {
    text-decoration: underline;
}
</style>
