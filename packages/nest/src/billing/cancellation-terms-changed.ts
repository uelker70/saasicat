import { ConflictException } from '@nestjs/common';
import { BILLING_ERROR_CODES, type AnnouncedDeletion } from '@saasicat/core';

/** What a cancellation confirmed now would apply, as its refusal carries it. */
export interface CancellationTermsNow {
    effectiveAt: Date;
    termEndsAt: Date | null;
    noticeDeadline: Date | null;
    afterNoticeDeadline: boolean | null;
    /** The read-only period, the last readable day and the deletion day; null where none is announced. */
    deletion: AnnouncedDeletion | null;
}

/**
 * The refusal of a cancellation whose date, or deletion day, is not the one
 * the page showed: what would apply now travels beside the code, so the page
 * can ask again with it instead of guessing why.
 */
export function cancellationTermsChanged(now: CancellationTermsNow): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.CANCELLATION_TERMS_CHANGED,
        message:
            'The cancellation changed since it was shown. Look at it again before confirming it.',
        ...now,
    });
}
