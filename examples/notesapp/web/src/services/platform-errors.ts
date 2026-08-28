// Turning a platform error into text a tenant can read.
//
// Every coded failure the platform raises carries `{ code, message, … }`, and
// `message` is English. `resolveErrorMessage` from `@saasicat/core` is the
// ladder that turns it into the reader's language:
//
//   1. this app's own catalogue — where you disagree with the platform's wording
//   2. the shipped catalogue for the active locale — 135 codes, translated
//   3. the English `message` the backend sent — for a code nobody has translated
//   4. the bare code — unreachable in practice, every coded error has a message
//
// The third rung is why `message` stays on the wire. A blocker that renders as
// an empty line leaves someone with a disabled button and no reason; English
// prose is worse than a translation and far better than nothing.
//
// The seam is here, in one place, rather than at each call site: a component
// that catches an error should ask for text, not assemble it.

import axios from 'axios';
import {
    ERROR_MESSAGES_DE,
    ERROR_MESSAGES_EN,
    resolveErrorMessage,
    type PlatformErrorBody,
} from '@saasicat/core';

/**
 * Wording this app prefers over the platform's, keyed by error code.
 *
 * Empty here on purpose: the shipped catalogue is the better default, and an
 * override is worth writing only where a code means something specific to this
 * application. Overriding a code you have not read is how two texts for one
 * situation start to drift.
 */
const OWN_MESSAGES: Partial<Record<string, string>> = {};

const CATALOGUES = { de: ERROR_MESSAGES_DE, en: ERROR_MESSAGES_EN } as const;

export type SupportedLocale = keyof typeof CATALOGUES;

/** The platform error body inside an unknown thrown value, or `null`. */
function platformErrorBody(
    error: unknown,
): (Partial<PlatformErrorBody> & Record<string, unknown>) | null {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        // A coded body is an object carrying `code`. An HTML error page or a
        // plain string is not one, and must not be read as though it were.
        if (
            data &&
            typeof data === 'object' &&
            typeof (data as { code?: unknown }).code === 'string'
        ) {
            return data as Partial<PlatformErrorBody> & Record<string, unknown>;
        }
    }
    return null;
}

/**
 * Display text for anything a call may throw.
 *
 * A coded platform error goes through the ladder. Anything else — a network
 * failure, a bug in this app — falls back to its own message, because inventing
 * a translation for it would say more than is known.
 */
export function errorText(error: unknown, locale: SupportedLocale = 'en'): string {
    const body = platformErrorBody(error);
    if (body) return resolveErrorMessage(body, OWN_MESSAGES, CATALOGUES[locale]);
    if (error instanceof Error) return error.message;
    return String(error);
}
