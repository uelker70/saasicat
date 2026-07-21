// Shared UI helpers for the discovery page (feature/quota cards, orphans,
// translation panel, StatusControl). In its own file because
// `<script setup>` allows no named exports and the cards share the same
// labels/colors/coverage calculations.

import type {
    CapabilityCodeStatus,
    CatalogEntryI18n,
    DiscoveryStatus,
} from '@saasicat/types';

/** Translatable fields of a catalog entry. */
export type I18nField = 'label' | 'description' | 'unit';

/** Normalized entry for the translation panel (feature / quota). */
export interface TransEntry {
    key: string;
    label: string;
    description: string | null;
    /** Quotas only — display unit, code-derived (default locale not editable). */
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

// ─── Approval lifecycle (#20): status display + state machine ────────────────

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
    /** Primary style (approve/re-approve) vs. ghost (revoke/reactivate). */
    emphasized: boolean;
    danger?: boolean;
}

/** Primary action per status (design sim `StatusControl`, #20). */
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

/** Kebab menu actions per status (design sim `StatusControl`, #20). */
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

// ─── Capability code status (read-only code facts, #20) ──────────────────────

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
 * Fraction 0..1 of filled translation fields of an entry in a given locale.
 * Fields without a default value don't count (except `label` — that's mandatory).
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
