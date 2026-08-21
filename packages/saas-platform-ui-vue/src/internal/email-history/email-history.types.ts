// Types of the shared EmailHistoryPage (platform email history) — deliberately
// extracted from the `.vue` so consumers can import them as regular TS types
// (a named type import directly from a `.vue` is not resolved through the
// `*.vue` module shim, but it is from this `.ts`; re-exported via the package
// index).

export type EmailHistoryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'BOUNCED';

/** List projection — deliberately without body (loaded only in the detail view). */
export interface EmailHistoryRow {
    id: string;
    fromEmail: string;
    toEmail: string;
    subject: string;
    status: EmailHistoryStatus;
    sentAt?: string | null;
    createdAt: string;
}

/** Complete entry including content, headers, SMTP response and errors. */
export interface EmailHistoryDetail extends EmailHistoryRow {
    ccEmail?: string | null;
    bccEmail?: string | null;
    bodyHtml?: string | null;
    bodyText?: string | null;
    errorMessage?: string | null;
    smtpResponse?: string | null;
}

/** Search/filter/pagination input — field names as in the backend (QueryEmailLogDto). */
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
