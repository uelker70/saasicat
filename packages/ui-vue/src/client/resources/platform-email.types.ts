// The SMTP provider shapes: a configured sender, what a write sends, and what a test reports.
//
// In `client/` rather than beside the page, because the RESOURCE answers with
// these shapes and the client layer may not read a page or an `internal/`
// folder. `internal/platform-email/platform-email.types.ts` re-exports them, so the pages and dialogs that
// already import from there keep working.

export interface PlatformEmailProvider {
    id: string;
    name: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    encryption: string;
    autoTls?: boolean;
    fromEmail: string;
    fromName?: string | null;
    isDefault: boolean;
    active: boolean;
    [extra: string]: unknown;
}

export interface PlatformEmailWriteInput {
    name: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword?: string;
    encryption: string;
    fromEmail: string;
    fromName?: string;
    active?: boolean;
}

export interface PlatformEmailTestInput {
    toEmail: string;
    subject?: string;
}

export interface PlatformEmailTestResult {
    success: boolean;
    message: string;
}
