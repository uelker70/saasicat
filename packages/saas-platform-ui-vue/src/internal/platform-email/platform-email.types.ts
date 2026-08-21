// Types of the shared PlatformEmailPage — deliberately extracted from the `.vue` so that
// consumers can import them as regular TS types. A named type import
// directly from a `.vue` is not resolved via the `*.vue` module shim (vue-tsc);
// from this `.ts` it is (re-exported via the package index).

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
