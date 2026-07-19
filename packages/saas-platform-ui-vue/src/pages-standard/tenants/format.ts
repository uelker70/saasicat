// Format-Helfer für die Tenants-Page.
//
// Geteilt zwischen TenantsPage.vue und Subkomponenten (Avatar, Pill).
// Apps mit eigenen Plan-Akzenten reichen sie via `planAccents`-Prop durch;
// die Default-Map deckt AutohausPro-Plans (BASIC..ENTERPRISE) ab.

export const DEFAULT_PLAN_ACCENTS: Record<string, string> = {
    BASIC: '#94a3b8',
    STANDARD: '#3f6bff',
    PROFESSIONAL: '#7c3aed',
    BUSINESS: '#0ea5e9',
    ENTERPRISE: '#0f172a',
};

export function tenantInitials(name: string | null | undefined): string {
    if (!name) return '?';
    return name
        .replace(/[^A-Za-zÄÖÜäöü]/g, '')
        .slice(0, 2)
        .toUpperCase();
}

export function planAccent(
    planId: string | null | undefined,
    accents: Record<string, string> = DEFAULT_PLAN_ACCENTS,
): string {
    if (!planId) return '#94a3b8';
    return accents[planId] ?? '#3f6bff';
}

export function formatDateDe(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}
