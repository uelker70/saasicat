// Geteilte UI-Helfer der Discovery-Seite (Feature-/Quota-Karten, Orphans,
// Übersetzungs-Panel, StatusControl). In einer eigenen Datei, weil
// `<script setup>` keine Named-Exports erlaubt und die Karten dieselben
// Labels/Farben/Coverage-Berechnungen teilen.

import type {
    CapabilityCodeStatus,
    CatalogEntryI18n,
    DiscoveryStatus,
} from '@saasicat/types';

/** Übersetzbare Felder eines Catalog-Entry. */
export type I18nField = 'label' | 'description' | 'unit';

/** Normalisierter Eintrag für das Übersetzungs-Panel (Feature / Quota). */
export interface TransEntry {
    key: string;
    label: string;
    description: string | null;
    /** Nur Quotas — Anzeige-Einheit, code-abgeleitet (Default-Locale nicht editierbar). */
    unit?: string;
    i18n: CatalogEntryI18n;
}

export const DISCOVERY_DEFAULT_LOCALE = 'de';

const LOCALE_NAMES: Record<string, { short: string; full: string }> = {
    de: { short: 'DE', full: 'Deutsch' },
    en: { short: 'EN', full: 'English' },
    tr: { short: 'TR', full: 'Türkçe' },
    fr: { short: 'FR', full: 'Français' },
    it: { short: 'IT', full: 'Italiano' },
    es: { short: 'ES', full: 'Español' },
    nl: { short: 'NL', full: 'Nederlands' },
    pl: { short: 'PL', full: 'Polski' },
};

export function localeShort(locale: string): string {
    return LOCALE_NAMES[locale]?.short ?? locale.toUpperCase();
}

export function localeFull(locale: string): string {
    return LOCALE_NAMES[locale]?.full ?? locale;
}

export function i18nFieldLabel(f: I18nField): string {
    return f === 'label' ? 'Label' : f === 'description' ? 'Beschreibung' : 'Einheit';
}

// ─── Freigabe-Lifecycle (#20): Status-Anzeige + Zustandsautomat ──────────────

export const STATUS_META: Record<DiscoveryStatus, { label: string; hint: string }> = {
    pending: {
        label: 'Pending',
        hint: 'Im Code gefunden, noch nicht freigegeben — steht der Planung nicht zur Verfügung.',
    },
    approved: {
        label: 'Approved',
        hint: 'Für Pläne, Bundles & Marketing freigegeben.',
    },
    outdated: {
        label: 'Outdated',
        hint: 'Code hat sich seit der Freigabe geändert — bitte erneut prüfen und freigeben.',
    },
    obsolete: {
        label: 'Obsolete',
        hint: 'Abgekündigt — nicht mehr verwenden, in neuen Plänen ausblenden.',
    },
};

export interface ReviewAction {
    label: string;
    to: DiscoveryStatus;
    /** Primär-Stil (Freigeben/Erneut freigeben) vs. Ghost (entziehen/reaktivieren). */
    emphasized: boolean;
    danger?: boolean;
}

/** Primär-Aktion je Status (Design-Sim `StatusControl`, #20). */
export function primaryReviewAction(status: DiscoveryStatus): ReviewAction {
    switch (status) {
        case 'pending':
            return { label: 'Freigeben', to: 'approved', emphasized: true };
        case 'approved':
            return { label: 'Freigabe entziehen', to: 'pending', emphasized: false };
        case 'outdated':
            return { label: 'Erneut freigeben', to: 'approved', emphasized: true };
        case 'obsolete':
            return { label: 'Reaktivieren', to: 'pending', emphasized: false };
    }
}

/** Kebab-Menü-Aktionen je Status (Design-Sim `StatusControl`, #20). */
export function reviewMenuActions(status: DiscoveryStatus): ReviewAction[] {
    switch (status) {
        case 'pending':
            return [
                { label: 'Als obsolet markieren', to: 'obsolete', emphasized: false, danger: true },
            ];
        case 'approved':
            return [
                { label: 'Als veraltet markieren', to: 'outdated', emphasized: false },
                { label: 'Als obsolet markieren', to: 'obsolete', emphasized: false, danger: true },
            ];
        case 'outdated':
            return [
                { label: 'Freigabe entziehen', to: 'pending', emphasized: false },
                { label: 'Als obsolet markieren', to: 'obsolete', emphasized: false, danger: true },
            ];
        case 'obsolete':
            return [];
    }
}

// ─── Capability-Code-Status (read-only Code-Fakten, #20) ────────────────────

const CODE_STATUS_LABELS: Record<CapabilityCodeStatus, string> = {
    active: 'Aktiv',
    experimental: 'Experimental',
    deprecated: 'Deprecated',
    retired: 'Retired',
};

export function codeStatusLabel(status: CapabilityCodeStatus): string {
    return CODE_STATUS_LABELS[status] ?? status;
}

const KIND_COLORS: Record<string, string> = {
    endpoint: '#2563eb',
    service: '#7c3aed',
    job: '#0891b2',
    event: '#f59e0b',
};

export function kindStyle(kind: string): Record<string, string> {
    const c = KIND_COLORS[kind] ?? '#64748b';
    return { background: `${c}1a`, color: c, borderColor: `${c}33` };
}

/**
 * Anteil 0..1 der gefüllten Übersetzungsfelder eines Eintrags in einer Locale.
 * Felder ohne Default-Wert zählen nicht (außer `label` — das ist Pflicht).
 */
export function entryCoverage(entry: TransEntry, locale: string, fields: I18nField[]): number {
    let total = 0;
    let filled = 0;
    for (const f of fields) {
        const base =
            f === 'unit'
                ? (entry.unit ?? '')
                : ((f === 'label' ? entry.label : entry.description) ?? '');
        if (f !== 'label' && !base.trim()) continue;
        total += 1;
        if ((entry.i18n?.[locale]?.[f] ?? '').trim()) filled += 1;
    }
    return total === 0 ? 1 : filled / total;
}

export function coveragePct(ratio: number): number {
    return Math.round(ratio * 100);
}

export function coverageClass(ratio: number): string {
    const p = coveragePct(ratio);
    return p === 100 ? 'complete' : p >= 50 ? 'warn' : 'low';
}
