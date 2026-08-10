// Shared UI helpers for the discovery page (feature/quota cards, orphans,
// translation panel, StatusControl). In its own file because
// `<script setup>` allows no named exports and the cards share the same
// labels/colors/coverage calculations.

import type { CatalogEntryI18n, DiscoveryStatus } from '@saasicat/types';
import type { SaMessages } from '../../client/i18n/messages.js';

// The resolved slices these helpers render from. Taking the catalog rather
// than a locale code is what lets an app-supplied language and `i18n.overrides`
// reach them — a raw `discoveryMessages[locale]` lookup only ever sees the two
// catalogs the platform ships.
type SaDiscoveryMessages = SaMessages['discovery'];
type SaCommonMessages = SaMessages['common'];

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

export function i18nFieldLabel(
    f: I18nField,
    discovery: SaDiscoveryMessages,
    common: SaCommonMessages,
): string {
    if (f === 'label') return discovery.trans.fieldLabel;
    if (f === 'description') return common.description;
    return discovery.unit;
}

// ─── Approval lifecycle (#20): status display + state machine ────────────────

export function statusLabel(status: DiscoveryStatus, discovery: SaDiscoveryMessages): string {
    return discovery.statusLabels[status];
}

export function statusHint(status: DiscoveryStatus, discovery: SaDiscoveryMessages): string {
    return discovery.statusHints[status];
}

export interface ReviewAction {
    label: string;
    to: DiscoveryStatus;
    /** Primary style (approve/re-approve) vs. ghost (revoke/reactivate). */
    emphasized: boolean;
    danger?: boolean;
}

/** Primary action per status (design sim `StatusControl`, #20). */
export function primaryReviewAction(
    status: DiscoveryStatus,
    discovery: SaDiscoveryMessages,
): ReviewAction {
    const actions = discovery.reviewActions;
    switch (status) {
        case 'pending':
            return { label: actions.approve, to: 'approved', emphasized: true };
        case 'approved':
            return { label: actions.revoke, to: 'pending', emphasized: false };
        case 'outdated':
            return { label: actions.reapprove, to: 'approved', emphasized: true };
        case 'obsolete':
            return { label: actions.reactivate, to: 'pending', emphasized: false };
    }
}

/** Kebab menu actions per status (design sim `StatusControl`, #20). */
export function reviewMenuActions(
    status: DiscoveryStatus,
    discovery: SaDiscoveryMessages,
): ReviewAction[] {
    const actions = discovery.reviewActions;
    const markObsolete: ReviewAction = {
        label: actions.markObsolete,
        to: 'obsolete',
        emphasized: false,
        danger: true,
    };
    switch (status) {
        case 'pending':
            return [markObsolete];
        case 'approved':
            return [
                { label: actions.markOutdated, to: 'outdated', emphasized: false },
                markObsolete,
            ];
        case 'outdated':
            return [{ label: actions.revoke, to: 'pending', emphasized: false }, markObsolete];
        case 'obsolete':
            return [];
    }
}

// ─── Capability kind styling (read-only code facts, #20) ─────────────────────

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
