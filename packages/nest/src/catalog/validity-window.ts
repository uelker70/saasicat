import { UnprocessableEntityException } from '@nestjs/common';

import { CATALOG_ERROR_CODES } from '@saasicat/core';

// When is a version of a catalog entity valid, and what makes a succession
// sound?
//
// Plans and bundles answer that identically — the same five rules, the same
// messages, the same shape of exception — and until this file they answered it
// in two places, sixty-five lines each, differing only in which error-code
// constant they named. That is the duplication that no tool reports as
// dangerous and every fix has to be applied twice: the gapless rule was
// extended once, and the second copy carries a comment saying "analogous to
// Plan" instead of the reasoning.
//
// The rules, in the order a publish meets them:
//
// 1. A published version has a start. It may come from the publish call or
//    from the draft, and the call wins.
// 2. That start is a date.
// 3. It is strictly after the predecessor's start — otherwise the two are in
//    the wrong order, or the same day carries two versions.
// 4. If the predecessor has an END, the successor starts on the day after it.
//    Anything else is a gap (a day with no valid version) or an overlap (a day
//    with two).
// 5. An end, if given, is a date strictly after the start.

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a caller may say about a version's window when publishing it. */
export interface ValidityWindowInput {
    validFrom?: string | null;
    validUntil?: string | null;
}

/** The predecessor this version succeeds, or `null` for the first one. */
export interface PreviousWindow {
    validFrom?: string | null;
    validUntil?: string | null;
}

/** The five refusals, named per entity so the caller keeps its own codes. */
export interface ValidityWindowCodes {
    readonly validFromRequired: string;
    readonly validFromInvalid: string;
    readonly validFromNotAfterPrevious: string;
    readonly validFromNotGapless: string;
    readonly validUntilInvalid: string;
    readonly validUntilBeforeFrom: string;
}

export const PLAN_VERSION_WINDOW_CODES: ValidityWindowCodes = {
    validFromRequired: CATALOG_ERROR_CODES.PLAN_VERSION_VALID_FROM_REQUIRED,
    validFromInvalid: CATALOG_ERROR_CODES.PLAN_VERSION_VALID_FROM_INVALID,
    validFromNotAfterPrevious: CATALOG_ERROR_CODES.PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS,
    validFromNotGapless: CATALOG_ERROR_CODES.PLAN_VERSION_VALID_FROM_NOT_GAPLESS,
    validUntilInvalid: CATALOG_ERROR_CODES.PLAN_VERSION_VALID_UNTIL_INVALID,
    validUntilBeforeFrom: CATALOG_ERROR_CODES.PLAN_VERSION_VALID_UNTIL_BEFORE_FROM,
};

export const BUNDLE_VERSION_WINDOW_CODES: ValidityWindowCodes = {
    validFromRequired: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_REQUIRED,
    validFromInvalid: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_INVALID,
    validFromNotAfterPrevious: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS,
    validFromNotGapless: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS,
    validUntilInvalid: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_UNTIL_INVALID,
    validUntilBeforeFrom: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM,
};

/**
 * Resolves the window a version is published with, or refuses the publish.
 *
 * `publishMeta` and `draft` are read differently on purpose. A start falls back
 * to the draft's when the call does not carry one, but an END does so only when
 * the call is SILENT about it: an explicit `null` there means "unbounded", and
 * `??` would read that as "no answer" and take the draft's end instead.
 */
export function resolveValidityWindow(
    publishMeta: ValidityWindowInput,
    draft: ValidityWindowInput,
    previous: PreviousWindow | null,
    codes: ValidityWindowCodes,
): { validFrom: Date; validUntil: Date | null } {
    const validFromInput = publishMeta.validFrom ?? draft.validFrom;
    if (!validFromInput) {
        throw new UnprocessableEntityException({
            code: codes.validFromRequired,
            message: 'validFrom must be set when publishing (on the draft or the publish call)..',
        });
    }

    const validFrom = new Date(validFromInput);
    if (Number.isNaN(validFrom.getTime())) {
        throw new UnprocessableEntityException({
            code: codes.validFromInvalid,
            message: `validFrom '${validFromInput}' is not a valid date`,
            params: { validFrom: validFromInput },
        });
    }

    if (previous?.validFrom) {
        const previousFrom = new Date(previous.validFrom);
        if (validFrom <= previousFrom) {
            throw new UnprocessableEntityException({
                code: codes.validFromNotAfterPrevious,
                message: `validFrom (${validFrom.toISOString()}) must be strictly after the validFrom of the previous version (${previous.validFrom}).`,
                params: {
                    validFrom: validFrom.toISOString(),
                    previousValidFrom: previous.validFrom,
                },
            });
        }

        if (previous.validUntil) {
            const requiredStart = new Date(new Date(previous.validUntil).getTime() + DAY_MS);
            if (validFrom.getTime() !== requiredStart.getTime()) {
                throw new UnprocessableEntityException({
                    code: codes.validFromNotGapless,
                    message:
                        `The predecessor has validUntil=${previous.validUntil.slice(0, 10)} — the successor must ` +
                        `start seamlessly on the next day (${requiredStart.toISOString().slice(0, 10)}). ` +
                        `Received: ${validFrom.toISOString().slice(0, 10)}.`,
                    params: { received: validFrom.toISOString().slice(0, 10) },
                    requiredValidFrom: requiredStart.toISOString().slice(0, 10),
                    previousValidUntil: previous.validUntil,
                });
            }
        }
    }

    const validUntilInput =
        publishMeta.validUntil !== undefined ? publishMeta.validUntil : draft.validUntil;
    const validUntil = validUntilInput ? new Date(validUntilInput) : null;
    if (validUntil && Number.isNaN(validUntil.getTime())) {
        throw new UnprocessableEntityException({
            code: codes.validUntilInvalid,
            message: `validUntil '${validUntilInput}' is not a valid date`,
            params: { validUntil: validUntilInput },
        });
    }
    if (validUntil && validUntil <= validFrom) {
        throw new UnprocessableEntityException({
            code: codes.validUntilBeforeFrom,
            message: `validUntil (${validUntil.toISOString()}) must be strictly after validFrom (${validFrom.toISOString()}).`,
            params: {
                validUntil: validUntil.toISOString(),
                validFrom: validFrom.toISOString(),
            },
        });
    }

    return { validFrom, validUntil };
}
