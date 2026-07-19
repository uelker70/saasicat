<template>
    <q-dialog
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        persistent
    >
        <q-card class="pc-dlg">
            <q-card-section class="pc-dlg__head">
                <div>
                    <div class="pc-dlg__title">Neuer Promo-Code</div>
                    <div class="pc-dlg__sub">
                        {{
                            subtitle ?? 'Code, Rabatt-Logik, Laufzeit und Plan-Zuordnung festlegen.'
                        }}
                    </div>
                </div>
                <q-btn
                    class="pc-dlg__close"
                    flat
                    dense
                    round
                    icon="close"
                    v-close-popup
                    :disable="loading"
                />
            </q-card-section>

            <q-card-section class="pc-dlg__body">
                <!-- Section: Code & Rabatt -->
                <div class="pc-section">
                    <div class="pc-section__title">Code &amp; Rabatt</div>
                    <div class="pc-grid pc-grid--2">
                        <div class="pc-field">
                            <div class="pc-field__label">Code</div>
                            <div class="pc-code-input">
                                <input
                                    v-model="form.code"
                                    class="pc-input pc-input--code"
                                    placeholder="z. B. WELCOME10"
                                    @input="onCodeInput"
                                />
                                <button
                                    type="button"
                                    class="pc-btn-mini"
                                    @click="form.code = randomCode()"
                                >
                                    Zufall
                                </button>
                            </div>
                            <div class="pc-field__hint">
                                Großbuchstaben, Zahlen, „-" und „_" · nach Anlage stabil
                            </div>
                        </div>

                        <div class="pc-field">
                            <div class="pc-field__label">Rabatt-Typ</div>
                            <div class="pc-type-grid">
                                <button
                                    v-for="o in TYPE_OPTIONS"
                                    :key="o.k"
                                    type="button"
                                    class="pc-type-opt"
                                    :class="{ 'pc-type-opt--active': form.valueType === o.k }"
                                    @click="form.valueType = o.k"
                                >
                                    <div class="pc-type-opt__label">{{ o.label }}</div>
                                    <div class="pc-type-opt__sub">{{ o.sub }}</div>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="pc-field" style="max-width: 280px">
                        <div class="pc-field__label">
                            {{ form.valueType === 'PERCENT' ? 'Rabatt in %' : 'Rabatt in €' }}
                        </div>
                        <input
                            v-model.number="form.value"
                            class="pc-input"
                            type="number"
                            min="1"
                            :max="form.valueType === 'PERCENT' ? 100 : undefined"
                        />
                    </div>
                </div>

                <!-- Section: Gültigkeit & Laufzeit -->
                <div class="pc-section">
                    <div class="pc-section__title">Gültigkeit &amp; Laufzeit</div>

                    <div v-if="plans.length > 0" class="pc-field">
                        <div class="pc-field__label">Anwendbar auf Pläne</div>
                        <div class="pc-plan-pick">
                            <button
                                v-for="p in plans"
                                :key="p.key"
                                type="button"
                                class="pc-plan-opt"
                                :class="{ 'pc-plan-opt--on': isPlanSelected(p.key) }"
                                :style="planChipStyle(p)"
                                @click="togglePlan(p.key)"
                            >
                                <span
                                    class="pc-plan-opt__mark"
                                    :style="{ background: p.color ?? '#64748b' }"
                                />
                                {{ p.label }}
                            </button>
                        </div>
                        <div class="pc-field__hint">
                            Leer = alle Pläne ({{ form.appliesToPlans.length }} ausgewählt)
                        </div>
                    </div>

                    <div class="pc-grid pc-grid--2">
                        <div class="pc-field">
                            <div class="pc-field__label">Laufzeit des Rabatts</div>
                            <div class="pc-dur">
                                <button
                                    v-for="o in DURATION_OPTIONS"
                                    :key="o.k"
                                    type="button"
                                    class="pc-dur-opt"
                                    :class="{ 'pc-dur-opt--active': form.durationType === o.k }"
                                    @click="form.durationType = o.k"
                                >
                                    {{ o.label }}
                                </button>
                            </div>
                            <input
                                v-if="form.durationType !== 'ONCE'"
                                v-model.number="form.durationValue"
                                class="pc-input"
                                type="number"
                                min="1"
                                style="margin-top: 8px; max-width: 120px"
                                :placeholder="
                                    form.durationType === 'MONTHS' ? 'Monate' : 'Perioden'
                                "
                            />
                        </div>

                        <div class="pc-field">
                            <div class="pc-field__label">Max. Einlösungen</div>
                            <input
                                v-model.number="form.maxRedemptions"
                                class="pc-input"
                                type="number"
                                min="1"
                                placeholder="leer = ∞"
                            />
                            <div class="pc-field__hint">Leerlassen für unbegrenzt</div>
                        </div>
                    </div>

                    <div class="pc-grid pc-grid--2">
                        <div class="pc-field">
                            <div class="pc-field__label">Gültig ab</div>
                            <input v-model="form.validFrom" class="pc-input" type="date" />
                        </div>
                        <div class="pc-field">
                            <div class="pc-field__label">Gültig bis</div>
                            <input v-model="form.validUntil" class="pc-input" type="date" />
                        </div>
                    </div>
                </div>

                <!-- Section: Kampagne & Notiz -->
                <div class="pc-section">
                    <div class="pc-section__title">Kampagne &amp; Notizen</div>
                    <div v-if="showCampaignTag" class="pc-field">
                        <div class="pc-field__label">Kampagne (optional)</div>
                        <input
                            v-model="form.campaignTag"
                            class="pc-input"
                            placeholder="z. B. Frühjahrs-Aktion 2026"
                        />
                        <div class="pc-field__hint">Gruppiert mehrere Codes optisch</div>
                    </div>
                    <div class="pc-field">
                        <div class="pc-field__label">Notiz (intern)</div>
                        <textarea
                            v-model="form.description"
                            class="pc-input"
                            rows="2"
                            placeholder="Kontext, Quelle, Sales-Bezug — wird nicht an Kunden ausgespielt."
                        />
                    </div>
                </div>

                <!-- Section: Erweitert (Backend-only Felder, eingeklappt) -->
                <div class="pc-section">
                    <button
                        type="button"
                        class="pc-section__toggle"
                        @click="advancedOpen = !advancedOpen"
                    >
                        <q-icon
                            :name="advancedOpen ? 'expand_more' : 'chevron_right'"
                            size="16px"
                        />
                        Erweiterte Einschränkungen
                    </button>
                    <div v-if="advancedOpen" class="pc-advanced">
                        <div class="pc-grid pc-grid--2">
                            <div class="pc-field">
                                <div class="pc-field__label">Nur für Abrechnungs-Zyklus</div>
                                <select v-model="form.appliesToBilling" class="pc-input">
                                    <option :value="undefined">Beide</option>
                                    <option value="MONTHLY">Monatlich</option>
                                    <option value="YEARLY">Jährlich</option>
                                </select>
                            </div>
                            <div class="pc-field">
                                <div class="pc-field__label">Mindest-Plan-Betrag (€ brutto)</div>
                                <input
                                    v-model.number="form.minimumPlanAmountGross"
                                    class="pc-input"
                                    type="number"
                                    min="0"
                                    placeholder="leer = keine Schwelle"
                                />
                            </div>
                        </div>
                        <div class="pc-grid pc-grid--2">
                            <label class="pc-check">
                                <input v-model="form.firstTimeCustomersOnly" type="checkbox" />
                                <span>Nur Neukunden</span>
                            </label>
                            <label class="pc-check">
                                <input v-model="form.allowZeroInvoice" type="checkbox" />
                                <span>0-€-Rechnung zulassen</span>
                            </label>
                        </div>
                        <div class="pc-field">
                            <div class="pc-field__label">Erlös-Minderungs-Konto (Buchhaltung)</div>
                            <input
                                v-model="form.revenueDeductionAccount"
                                class="pc-input"
                                placeholder="z. B. 8736"
                            />
                        </div>
                    </div>
                </div>

                <!-- Live-Preview -->
                <div class="pc-preview">
                    <div class="pc-preview__eyebrow">Vorschau im Catalog</div>
                    <div class="pc-preview__body">
                        <code class="pc-preview__code">{{ form.code || 'CODE' }}</code>
                        <span class="pc-preview__disc">{{ previewValue }}</span>
                        <span class="pc-preview__meta">{{ previewMeta }}</span>
                    </div>
                </div>

                <p v-if="error" class="pc-error">{{ error }}</p>
            </q-card-section>

            <q-card-actions align="right" class="pc-dlg__foot">
                <q-btn flat label="Abbrechen" v-close-popup :disable="loading" />
                <q-btn
                    unelevated
                    color="primary"
                    label="Anlegen"
                    :loading="loading"
                    :disable="!isValid"
                    @click="onSubmit"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type {
    PromoCodeCreatePayload,
    PromoCodeDurationType,
    PromoCodePlanOption,
    PromoCodeValueType,
} from './types.js';

// Plattform-PromoCode-Create-Dialog (Sim-Layout: Sektionen, Type-Grid,
// Plan-Picker, Live-Preview). App liefert Submit-Handler und optional die
// Plan-Liste für den Plan-Picker (z. B. aus dem Manifest-Snapshot). Wenn
// keine Pläne durchgereicht werden, blendet die Plan-Auswahl-Sektion aus.

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        subtitle?: string;
        showCampaignTag?: boolean;
        plans?: readonly PromoCodePlanOption[];
        submit: (payload: PromoCodeCreatePayload) => Promise<void>;
    }>(),
    {
        showCampaignTag: true,
        plans: () => [],
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'created'): void;
}>();

const TYPE_OPTIONS: ReadonlyArray<{ k: PromoCodeValueType; label: string; sub: string }> = [
    { k: 'PERCENT', label: 'Prozent', sub: '−x %' },
    { k: 'ABSOLUTE', label: 'Fester €', sub: '−x €' },
];

const DURATION_OPTIONS: ReadonlyArray<{ k: PromoCodeDurationType; label: string }> = [
    { k: 'ONCE', label: 'Einmalig' },
    { k: 'MONTHS', label: 'N Monate' },
    { k: 'BILLING_CYCLES', label: 'N Perioden' },
];

function emptyForm() {
    return {
        code: '',
        valueType: 'PERCENT' as PromoCodeValueType,
        value: 25 as number,
        durationType: 'BILLING_CYCLES' as PromoCodeDurationType,
        durationValue: 1 as number | null,
        maxRedemptions: null as number | null,
        validFrom: '' as string,
        validUntil: '' as string,
        appliesToPlans: [] as string[],
        appliesToBilling: undefined as 'MONTHLY' | 'YEARLY' | undefined,
        firstTimeCustomersOnly: false,
        minimumPlanAmountGross: null as number | null,
        allowZeroInvoice: false,
        revenueDeductionAccount: '',
        campaignTag: '',
        description: '',
    };
}

const form = reactive(emptyForm());
const loading = ref(false);
const error = ref('');
const advancedOpen = ref(false);

function onCodeInput(): void {
    form.code = form.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function randomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

function isPlanSelected(key: string): boolean {
    return form.appliesToPlans.includes(key);
}
function togglePlan(key: string): void {
    if (form.appliesToPlans.includes(key)) {
        form.appliesToPlans = form.appliesToPlans.filter((k) => k !== key);
    } else {
        form.appliesToPlans = [...form.appliesToPlans, key];
    }
}
function planChipStyle(p: PromoCodePlanOption): Record<string, string> {
    if (!isPlanSelected(p.key) || !p.color) return {};
    return {
        borderColor: p.color,
        background: `${p.color}12`,
        color: p.color,
    };
}

const previewValue = computed(() => {
    if (form.valueType === 'PERCENT') return `−${form.value || 0}%`;
    return `−${form.value || 0} €`;
});

const previewMeta = computed(() => {
    const parts: string[] = [];
    if (form.durationType === 'ONCE') parts.push('einmalig');
    else if (form.durationType === 'MONTHS') parts.push(`${form.durationValue || 0} Monate`);
    else parts.push(`${form.durationValue || 0} Perioden`);
    parts.push(
        form.appliesToPlans.length > 0
            ? form.appliesToPlans.join(', ')
            : props.plans.length > 0
              ? 'alle Pläne'
              : 'kein Plan-Filter',
    );
    if (form.maxRedemptions) parts.push(`max. ${form.maxRedemptions}`);
    return parts.join(' · ');
});

const isValid = computed(() => {
    if (!/^[A-Z0-9_-]{3,32}$/.test(form.code)) return false;
    if (!form.value || form.value <= 0) return false;
    if (form.valueType === 'PERCENT' && form.value > 100) return false;
    if (form.durationType !== 'ONCE' && (!form.durationValue || form.durationValue < 1))
        return false;
    return true;
});

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            Object.assign(form, emptyForm());
            error.value = '';
            advancedOpen.value = false;
        }
    },
);

async function onSubmit() {
    if (!isValid.value) return;
    loading.value = true;
    error.value = '';
    try {
        await props.submit({
            code: form.code,
            valueType: form.valueType,
            value: form.value,
            durationType: form.durationType,
            durationValue: form.durationType === 'ONCE' ? null : form.durationValue,
            maxRedemptions: form.maxRedemptions ?? null,
            validFrom: form.validFrom || null,
            validUntil: form.validUntil || null,
            appliesToPlans: form.appliesToPlans.length > 0 ? [...form.appliesToPlans] : undefined,
            appliesToBilling: form.appliesToBilling,
            firstTimeCustomersOnly: form.firstTimeCustomersOnly || undefined,
            minimumPlanAmountGross: form.minimumPlanAmountGross ?? undefined,
            allowZeroInvoice: form.allowZeroInvoice || undefined,
            revenueDeductionAccount: form.revenueDeductionAccount || undefined,
            campaignTag: form.campaignTag || undefined,
            description: form.description || undefined,
        });
        emit('created');
        emit('update:modelValue', false);
    } catch (err) {
        error.value =
            (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
            (err as Error).message ??
            'Anlegen fehlgeschlagen';
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.pc-dlg {
    min-width: 720px;
    max-width: 96vw;
}
.pc-dlg__head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 8px;
}
.pc-dlg__close {
    margin-left: auto;
}
.pc-dlg__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 18px;
    color: var(--sa-heading, #0f172a);
}
.pc-dlg__sub {
    font-size: 12.5px;
    color: var(--sa-muted, #64748b);
    margin-top: 2px;
}
.pc-dlg__body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 4px;
}
.pc-dlg__foot {
    border-top: 1px solid var(--sa-border, #e2e8f0);
}

.pc-section {
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 10px;
    padding: 14px 16px;
    background: #fafbfc;
}
.pc-section__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 13px;
    color: var(--sa-heading, #0f172a);
    margin-bottom: 12px;
    letter-spacing: -0.005em;
}
.pc-section__toggle {
    border: 0;
    background: transparent;
    cursor: pointer;
    font: 600 12.5px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-muted-dark, #475569);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
}
.pc-advanced {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 12px;
}

.pc-grid {
    display: grid;
    gap: 12px;
    margin-bottom: 12px;
}
.pc-grid--2 {
    grid-template-columns: 1fr 1fr;
}
@media (max-width: 600px) {
    .pc-grid--2 {
        grid-template-columns: 1fr;
    }
}
.pc-grid:last-child {
    margin-bottom: 0;
}

.pc-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.pc-field__label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.pc-field__hint {
    font-size: 11.5px;
    color: #94a3b8;
}

.pc-input {
    width: 100%;
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 7px;
    padding: 8px 10px;
    font: 13.5px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-body, #1e293b);
    outline: 0;
}
.pc-input:focus {
    border-color: var(--sa-primary, #3f6bff);
    box-shadow: 0 0 0 3px rgba(63, 107, 255, 0.12);
}
.pc-input--code {
    font: 600 14px var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
textarea.pc-input {
    font: 13.5px var(--sa-font-body, system-ui, sans-serif);
    resize: vertical;
}

.pc-code-input {
    display: flex;
    gap: 8px;
    align-items: center;
}
.pc-btn-mini {
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 7px;
    padding: 6px 10px;
    font: 500 12px var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-muted-dark, #475569);
}
.pc-btn-mini:hover {
    background: #f1f5f9;
}

.pc-type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
}
.pc-type-opt {
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 8px;
    padding: 8px 10px;
    text-align: left;
    cursor: pointer;
    transition:
        border-color 0.1s,
        background 0.1s;
}
.pc-type-opt:hover {
    border-color: #cbd5e1;
}
.pc-type-opt--active {
    border-color: var(--sa-primary, #3f6bff);
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
}
.pc-type-opt__label {
    font: 600 12.5px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-heading, #0f172a);
}
.pc-type-opt__sub {
    font: 11.5px var(--sa-font-mono, ui-monospace, monospace);
    color: var(--sa-muted, #64748b);
    margin-top: 1px;
}

.pc-plan-pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.pc-plan-opt {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 999px;
    padding: 5px 12px 5px 8px;
    font: 600 12px var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-muted-dark, #475569);
    transition:
        border-color 0.1s,
        background 0.1s;
}
.pc-plan-opt:hover {
    border-color: #cbd5e1;
}
.pc-plan-opt--on {
    border-color: var(--sa-primary, #3f6bff);
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    color: var(--sa-primary, #3f6bff);
}
.pc-plan-opt__mark {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.pc-dur {
    display: flex;
    gap: 4px;
}
.pc-dur-opt {
    flex: 1;
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 7px;
    padding: 6px 10px;
    font: 500 12px var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-muted-dark, #475569);
}
.pc-dur-opt--active {
    border-color: var(--sa-primary, #3f6bff);
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    color: var(--sa-primary, #3f6bff);
}

.pc-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 13px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-body, #1e293b);
    cursor: pointer;
}

.pc-preview {
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.06));
    border: 1px solid var(--sa-primary-border, rgba(63, 107, 255, 0.18));
    border-radius: 10px;
    padding: 12px 14px;
}
.pc-preview__eyebrow {
    font-size: 11px;
    font-weight: 700;
    color: var(--sa-primary, #3f6bff);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
}
.pc-preview__body {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.pc-preview__code {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 6px;
    padding: 3px 8px;
    font: 600 13px var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: 0.04em;
    color: var(--sa-heading, #0f172a);
}
.pc-preview__disc {
    font: 700 13px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-positive, #047857);
}
.pc-preview__meta {
    font-size: 12px;
    color: var(--sa-muted, #64748b);
}

.pc-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    font-size: 13px;
    margin: 8px 0 0;
    padding: 8px 12px;
    border-radius: 8px;
}
</style>
