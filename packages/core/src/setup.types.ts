// First-run setup — wire types for the public, self-locking SuperAdmin
// bootstrap via the admin UI (`/api/v1/admin/setup`).
//
// The window is only open while 0 SUPER_ADMIN exist, and is additionally
// protected by an operator-set `SETUP_TOKEN` (env var).

export interface SetupStatusResponse {
    /** true as long as no SUPER_ADMIN exists — the UI then shows the wizard. */
    needsSetup: boolean;
}

export interface SetupRequest {
    /** Must match the server-side `SETUP_TOKEN` (env var). */
    token: string;
    email: string;
    /** Optional — if absent, the server generates one and returns it. */
    password?: string;
}

export interface SetupResult {
    userId: string;
    email: string;
    /** otpauth:// URI (fallback / deep link). */
    otpauthUri: string;
    /** Server-side rendered QR code as a PNG data URL for scanning. */
    qrDataUrl: string;
    /** Base32 TOTP secret as a fallback for manual entry. */
    secret: string;
    /** Set when the server generated the password (no `password` in the request). */
    generatedPassword?: string;
}

export interface SetupConfirmMfaRequest {
    token: string;
    userId: string;
    /** TOTP code from the authenticator app. */
    code: string;
}

export interface SetupConfirmMfaResponse {
    ok: boolean;
}
