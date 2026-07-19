// First-Run-Setup — Wire-Typen für den öffentlichen, selbstverriegelnden
// SuperAdmin-Bootstrap über das Admin-UI (`/api/v1/admin/setup`).
//
// Das Fenster ist nur offen, solange 0 SUPER_ADMIN existieren, und zusätzlich
// durch ein operator-gesetztes `SETUP_TOKEN` (Env-Var) geschützt.

export interface SetupStatusResponse {
    /** true, solange kein SUPER_ADMIN existiert — UI zeigt dann den Wizard. */
    needsSetup: boolean;
}

export interface SetupRequest {
    /** Muss dem server-seitigen `SETUP_TOKEN` (Env-Var) entsprechen. */
    token: string;
    email: string;
    /** Optional — fehlt es, generiert der Server eines und gibt es zurück. */
    password?: string;
}

export interface SetupResult {
    userId: string;
    email: string;
    /** otpauth://-URI (Fallback / Tiefenlink). */
    otpauthUri: string;
    /** Serverseitig gerenderter QR-Code als PNG-Data-URL zum Scannen. */
    qrDataUrl: string;
    /** Base32-TOTP-Secret als Fallback zur manuellen Eingabe. */
    secret: string;
    /** Gesetzt, wenn der Server das Passwort generiert hat (kein `password` im Request). */
    generatedPassword?: string;
}

export interface SetupConfirmMfaRequest {
    token: string;
    userId: string;
    /** TOTP-Code aus der Authenticator-App. */
    code: string;
}

export interface SetupConfirmMfaResponse {
    ok: boolean;
}
