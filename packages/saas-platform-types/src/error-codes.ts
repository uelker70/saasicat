// Central error codes shared by backend AND frontend. Single source of
// truth, so that service response and UI mapping do not silently drift
// apart. String literals stay stable as the wire format.

/** Codes of the first-run setup endpoints (`SetupController`). */
export const SETUP_ERROR_CODES = {
    /** `SETUP_TOKEN` env not set → setup disabled. */
    SETUP_DISABLED: 'SETUP_DISABLED',
    /** Provided token does not match. */
    INVALID_SETUP_TOKEN: 'INVALID_SETUP_TOKEN',
    /** A SUPER_ADMIN already exists — self-disable. */
    SETUP_ALREADY_DONE: 'SETUP_ALREADY_DONE',
    /** Invalid email in the request. */
    INVALID_EMAIL: 'INVALID_EMAIL',
    /** Email already taken (mapped from `PlatformUserExistsError`). */
    EMAIL_EXISTS: 'EMAIL_EXISTS',
} as const;

export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[keyof typeof SETUP_ERROR_CODES];
