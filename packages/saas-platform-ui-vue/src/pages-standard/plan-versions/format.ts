// Formatting helpers for the plan-versions views.
//
// Phase 2c: Ported from a consumer admin.
// The time reference point for `formatRelativeDe` is the moment of the call,
// not a hard-coded demo date (the ported template had `2026-05-04` —
// the platform must work in production).

export function fmtEuro(n: number): string {
    if (n === 0) return 'individuell';
    return n.toFixed(2).replace('.', ',') + ' €';
}

export function fmtStorage(gb: number): string {
    if (gb === 0) return '500 MB';
    if (gb >= 1000 && gb % 1000 === 0) return `${gb / 1000} TB`;
    return `${gb} GB`;
}

export function formatRelativeDe(iso: string | undefined, now: Date = new Date()): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const diffMs = now.getTime() - d.getTime();
    const days = Math.floor(diffMs / 86_400_000);
    if (days === 0) return 'heute';
    if (days === 1) return 'gestern';
    if (days < 7) return `vor ${days} Tagen`;
    if (days < 30) {
        const w = Math.floor(days / 7);
        return `vor ${w} Woche${w > 1 ? 'n' : ''}`;
    }
    if (days < 365) return `vor ${Math.floor(days / 30)} Monaten`;
    const y = Math.floor(days / 365);
    return `vor ${y} Jahr${y > 1 ? 'en' : ''}`;
}

export function formatDateDe(iso: string | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

export function formatTsDe(iso: string): string {
    return new Date(iso).toLocaleString('de-DE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
