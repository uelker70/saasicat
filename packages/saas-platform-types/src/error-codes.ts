// Zentrale, von Backend UND Frontend geteilte Error-Codes. Single source of
// truth, damit Service-Response und UI-Mapping nicht stillschweigend
// auseinanderlaufen. String-Literale bleiben als Wire-Format stabil.

/** Codes der First-Run-Setup-Endpoints (`SetupController`). */
export const SETUP_ERROR_CODES = {
    /** `SETUP_TOKEN`-Env nicht gesetzt → Setup deaktiviert. */
    SETUP_DISABLED: 'SETUP_DISABLED',
    /** Mitgegebenes Token stimmt nicht. */
    INVALID_SETUP_TOKEN: 'INVALID_SETUP_TOKEN',
    /** Es existiert bereits ein SUPER_ADMIN — Self-Disable. */
    SETUP_ALREADY_DONE: 'SETUP_ALREADY_DONE',
    /** Ungültige E-Mail im Request. */
    INVALID_EMAIL: 'INVALID_EMAIL',
    /** E-Mail bereits vergeben (gemappt aus `PlatformUserExistsError`). */
    EMAIL_EXISTS: 'EMAIL_EXISTS',
} as const;

export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[keyof typeof SETUP_ERROR_CODES];
