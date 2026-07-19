// Typen der geteilten EmailHistoryPage (Plattform-E-Mail-Verlauf) — bewusst aus
// der `.vue` ausgelagert, damit Konsumenten sie als reguläre TS-Typen importieren
// können (ein Named-Type-Import direkt aus einer `.vue` wird über den
// `*.vue`-Modul-Shim nicht aufgelöst, aus dieser `.ts` schon; re-exportiert über
// den Paket-Index).

export type EmailHistoryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'BOUNCED';

/** Listen-Projektion — bewusst ohne Body (wird erst im Detail geladen). */
export interface EmailHistoryRow {
    id: string;
    fromEmail: string;
    toEmail: string;
    subject: string;
    status: EmailHistoryStatus;
    sentAt?: string | null;
    createdAt: string;
}

/** Vollständiger Eintrag inkl. Inhalt, Kopfzeilen, SMTP-Antwort und Fehler. */
export interface EmailHistoryDetail extends EmailHistoryRow {
    ccEmail?: string | null;
    bccEmail?: string | null;
    bodyHtml?: string | null;
    bodyText?: string | null;
    errorMessage?: string | null;
    smtpResponse?: string | null;
}

/** Such-/Filter-/Pagination-Eingabe — Feldnamen wie das Backend (QueryEmailLogDto). */
export interface EmailHistoryFilter {
    search?: string;
    status?: EmailHistoryStatus;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

export interface EmailHistoryListResult {
    rows: EmailHistoryRow[];
    total: number;
}

export interface EmailHistoryResendResult {
    success: boolean;
    message?: string;
}
