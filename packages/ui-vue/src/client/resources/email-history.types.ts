// The send-log shapes: a row, its detail, the filter and the two result types.
//
// In `client/` rather than beside the page, because the RESOURCE answers with
// these shapes and the client layer may not read a page or an `internal/`
// folder. `internal/email-history/email-history.types.ts` re-exports them, so the pages and dialogs that
// already import from there keep working.

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
