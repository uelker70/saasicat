// Typen der shared PlatformEmailPage — bewusst aus der `.vue` ausgelagert, damit
// Konsumenten sie als reguläre TS-Typen importieren können. Ein Named-Type-Import
// direkt aus einer `.vue` wird über den `*.vue`-Modul-Shim (vue-tsc) nicht
// aufgelöst; aus dieser `.ts` schon (re-exportiert über den Paket-Index).

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
