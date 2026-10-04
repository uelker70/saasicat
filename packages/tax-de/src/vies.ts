// The check of a VAT identification number through VIES, the European
// Commission's service.
//
// VIES answers every request with HTTP 200 — a number it found invalid as
// `valid: false`, a failure as `actionSucceed: false` with an error code — so
// the status line says little and the body decides. A check that does not
// complete is never read as valid (`SC-PRIC-040`): an error, a timeout and an
// answer this client cannot read each end as `completed: false`.

import type { VatIdCheckOutcome } from '@saasicat/core';

/** The service named on every check this client records. */
const VIES_SERVICE = 'VIES';

/** The REST endpoint that checks one number. */
const VIES_CHECK_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

/**
 * The one error code that is an answer about the number rather than a failure
 * to give one: VIES cannot read it as a VAT identification number at all.
 */
const MALFORMED_NUMBER = 'INVALID_INPUT';

export interface ViesClientOptions {
    fetch: typeof globalThis.fetch;
    /** How long an answer may take before the check counts as not completed. */
    timeoutMs: number;
    /** The platform's clock, read when the answer arrives. */
    now: () => Date;
}

/** The two parts VIES takes a number in: the country prefix and the rest. */
function splitVatId(vatId: string): { countryCode: string; vatNumber: string } {
    return { countryCode: vatId.slice(0, 2), vatNumber: vatId.slice(2) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every text field of the answer, as the service sent it. */
function confirmationOf(body: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(body).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
    );
}

/** The first error code of a failed answer, or `null` when it carries none. */
function errorCodeOf(body: Record<string, unknown>): string | null {
    const wrappers = body['errorWrappers'];
    if (!Array.isArray(wrappers)) return null;
    const first: unknown = wrappers[0];
    return isRecord(first) && typeof first['error'] === 'string' ? first['error'] : null;
}

function notCompleted(reason: string): VatIdCheckOutcome {
    return { completed: false, reason };
}

/** What a body VIES sent back amounts to. */
function readAnswer(vatId: string, body: unknown, checkedAt: Date): VatIdCheckOutcome {
    if (!isRecord(body)) return notCompleted('VIES answered in a form the adapter cannot read.');
    if (body['actionSucceed'] === false) {
        const code = errorCodeOf(body);
        if (code !== MALFORMED_NUMBER) {
            return notCompleted(`VIES could not check the number: ${code ?? 'no error code'}.`);
        }
        return {
            completed: true,
            check: {
                vatId,
                checkedAt,
                valid: false,
                service: VIES_SERVICE,
                confirmation: { error: code },
            },
        };
    }
    if (typeof body['valid'] !== 'boolean') {
        return notCompleted('VIES answered in a form the adapter cannot read.');
    }
    return {
        completed: true,
        check: {
            vatId,
            checkedAt,
            valid: body['valid'],
            service: VIES_SERVICE,
            confirmation: confirmationOf(body),
        },
    };
}

/**
 * Checks `vatId` with VIES. Where the issuer has a VAT identification number
 * of its own, the request names it as the requester, so the answer carries a
 * request identifier that confirms the check was made.
 */
export async function checkVatIdWithVies(
    vatId: string,
    requesterVatId: string | null,
    options: ViesClientOptions,
): Promise<VatIdCheckOutcome> {
    const { countryCode, vatNumber } = splitVatId(vatId);
    const requester = requesterVatId === null ? null : splitVatId(requesterVatId);
    const request = {
        countryCode,
        vatNumber,
        ...(requester && {
            requesterMemberStateCode: requester.countryCode,
            requesterNumber: requester.vatNumber,
        }),
    };
    let body: unknown;
    try {
        const response = await options.fetch(VIES_CHECK_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!response.ok) return notCompleted(`VIES answered with HTTP ${response.status}.`);
        // The headers can arrive well before the body, and the timeout covers both.
        body = await response.json();
    } catch (error) {
        return notCompleted(whyNoAnswer(error, options.timeoutMs));
    }
    // Dated once the whole answer is in: `keepsVatIdCheck` lets the check with the
    // latest date count, so a date taken when only the headers had arrived would
    // let a slower answer pass for an earlier one.
    return readAnswer(vatId, body, options.now());
}

/** Why a request brought no answer to read. */
function whyNoAnswer(error: unknown, timeoutMs: number): string {
    if (error instanceof Error && error.name === 'TimeoutError') {
        return `VIES did not answer within ${timeoutMs} ms.`;
    }
    if (error instanceof SyntaxError) return 'VIES answered in a form the adapter cannot read.';
    const detail = error instanceof Error ? error.message : String(error);
    return `VIES could not be reached: ${detail}`;
}
