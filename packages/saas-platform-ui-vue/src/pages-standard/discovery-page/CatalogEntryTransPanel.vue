<template>
    <div class="sa-trans">
        <!-- Default locale: editable source -->
        <div class="sa-trans-lang sa-trans-lang--source">
            <div class="sa-trans-lang__head">
                <span class="sa-trans-lang__code">{{ defaultLocale.toUpperCase() }}</span>
                <span class="sa-trans-lang__name">{{ localeFull(defaultLocale) }}</span>
                <span class="sa-trans-lang__badge">Source</span>
            </div>
            <div class="sa-trans-fields">
                <div v-for="f in fields" :key="f" class="sa-trans-field">
                    <label class="sa-trans-field__cap">{{ i18nFieldLabel(f) }}</label>
                    <q-input
                        v-if="f !== 'unit'"
                        dense
                        outlined
                        :type="f === 'description' ? 'textarea' : 'text'"
                        :autogrow="f === 'description'"
                        :model-value="baseValue(f)"
                        @update:model-value="(v) => onBase(f, String(v ?? ''))"
                    />
                    <div v-else class="sa-trans-locked">
                        {{ entry.unit || '—' }}
                        <span class="sa-trans-locked__hint">aus Code</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Target languages -->
        <div v-for="lng in targetLocales" :key="lng" class="sa-trans-lang">
            <div class="sa-trans-lang__head">
                <span class="sa-trans-lang__code">{{ localeShort(lng) }}</span>
                <span class="sa-trans-lang__name">{{ localeFull(lng) }}</span>
                <q-btn
                    flat
                    dense
                    no-caps
                    size="sm"
                    icon="content_copy"
                    label="Aus DE"
                    class="sa-trans-lang__copy"
                    @click="copyFromDefault(lng)"
                >
                    <q-tooltip>Leere Felder aus der Default-Locale übernehmen</q-tooltip>
                </q-btn>
            </div>
            <div class="sa-trans-fields">
                <div v-for="f in fields" :key="f" class="sa-trans-field">
                    <label class="sa-trans-field__cap">{{ i18nFieldLabel(f) }}</label>
                    <q-input
                        dense
                        outlined
                        :type="f === 'description' ? 'textarea' : 'text'"
                        :autogrow="f === 'description'"
                        :model-value="localeValue(lng, f)"
                        :placeholder="baseValue(f) ? `Fallback: „${baseValue(f)}“` : '—'"
                        @update:model-value="(v) => onLocale(lng, f, String(v ?? ''))"
                    />
                </div>
            </div>
        </div>

        <div v-if="targetLocales.length === 0" class="sa-trans__empty">
            Keine weiteren Sprachen aktiv — Sprachen werden im Marketing-Catalog aktiviert.
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { CatalogEntryI18nFields } from '@saasicat/types';
import {
    DISCOVERY_DEFAULT_LOCALE,
    i18nFieldLabel,
    localeFull,
    localeShort,
    type I18nField,
    type TransEntry,
} from './discovery-ui.js';

// Translation block of a single catalog entry (feature / quota) —
// embedded in the collapsible card (#20, Sim `TransPanel`). Default-
// locale fields are editable (source of truth), target languages carry
// overrides; empty fields fall back to the default locale in the consumer.

const props = withDefaults(
    defineProps<{
        entry: TransEntry;
        /** Fields to translate; order = display order. */
        fields: I18nField[];
        /** All active locales incl. default. */
        activeLocales: string[];
        defaultLocale?: string;
    }>(),
    { defaultLocale: DISCOVERY_DEFAULT_LOCALE },
);

const emit = defineEmits<{
    /** Default-locale base field changed (`label`/`description`). */
    'update:base': [patch: { label?: string; description?: string }];
    /** Target-locale override changed. */
    'update:locale': [locale: string, patch: CatalogEntryI18nFields];
}>();

const targetLocales = computed(() => props.activeLocales.filter((l) => l !== props.defaultLocale));

// Local input buffer: once a field has been edited, the draft wins over
// the prop value. Persistence is debounced — without this buffer, a late-
// returning PATCH response would reset the field to a stale state and
// swallow the most recently typed characters.
const drafts = reactive<Record<string, string>>({});

function baseValue(f: I18nField): string {
    if (f === 'unit') return props.entry.unit ?? '';
    const dk = `b|${f}`;
    if (dk in drafts) return drafts[dk];
    return (f === 'label' ? props.entry.label : props.entry.description) ?? '';
}

function localeValue(locale: string, f: I18nField): string {
    const dk = `l|${locale}|${f}`;
    if (dk in drafts) return drafts[dk];
    return props.entry.i18n?.[locale]?.[f] ?? '';
}

function onBase(f: I18nField, value: string): void {
    if (f === 'unit') return;
    drafts[`b|${f}`] = value;
    emit('update:base', { [f]: value });
}

function onLocale(locale: string, f: I18nField, value: string): void {
    drafts[`l|${locale}|${f}`] = value;
    emit('update:locale', locale, { [f]: value });
}

/** Fills empty target fields from the default locale. */
function copyFromDefault(locale: string): void {
    const patch: CatalogEntryI18nFields = {};
    for (const f of props.fields) {
        if (!localeValue(locale, f).trim()) {
            const base = baseValue(f).trim();
            if (base) patch[f] = base;
        }
    }
    if (Object.keys(patch).length === 0) return;
    for (const [f, value] of Object.entries(patch)) {
        drafts[`l|${locale}|${f}`] = value ?? '';
    }
    emit('update:locale', locale, patch);
}
</script>

<style scoped>
.sa-trans {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
}
.sa-trans-lang {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
    padding: 10px 12px;
}
.sa-trans-lang--source {
    background: #f8fafc;
    border-color: #cbd5e1;
}
.sa-trans-lang__head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}
.sa-trans-lang__code {
    font-size: 10px;
    font-weight: 700;
    background: #0f172a;
    color: #fff;
    padding: 2px 6px;
    border-radius: 5px;
}
.sa-trans-lang__name {
    font-size: 12px;
    font-weight: 600;
    color: #334155;
    flex: 1;
}
.sa-trans-lang__badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #475569;
    background: #e2e8f0;
    padding: 2px 6px;
    border-radius: 5px;
}
.sa-trans-lang__copy {
    color: #475569;
}
.sa-trans-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.sa-trans-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.sa-trans-field__cap {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: #94a3b8;
}
.sa-trans-locked {
    font-size: 13px;
    color: #334155;
    background: #f1f5f9;
    border: 1px dashed #cbd5e1;
    border-radius: 6px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-trans-locked__hint {
    font-size: 10px;
    color: #94a3b8;
    text-transform: uppercase;
}
.sa-trans__empty {
    grid-column: 1 / -1;
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: #94a3b8;
    border: 1px dashed #cbd5e1;
    border-radius: 10px;
}
</style>
