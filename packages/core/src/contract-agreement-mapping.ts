// The agreement a scheduled change or a booking records (`ContractAgreement`),
// read back from the three columns that hold it. Pure, and shared by both
// adapters.

import type { ContractAgreement } from './subscription-contract.types.js';
import { TERMS_VERSION_PATTERN } from './terms.types.js';

/** The three columns of an agreement, as a row holds them. */
export interface ContractAgreementColumns {
    termsVersion: string | null | undefined;
    cancellationNoticeDays: number | null | undefined;
    agreedAt: Date | null | undefined;
}

/**
 * The agreement the columns hold, or `null` where they hold none — a booking
 * or a change made before agreements were recorded, or no change scheduled.
 * Refused where only some of them are set, or where one holds a value no
 * agreement could: the contract the change ends in would record it.
 */
export function toContractAgreement(
    columns: ContractAgreementColumns,
    where: string,
): ContractAgreement | null {
    const { termsVersion, cancellationNoticeDays: days, agreedAt } = columns;
    if (agreedAt == null && days == null && termsVersion == null) return null;
    const complete =
        agreedAt instanceof Date &&
        !Number.isNaN(agreedAt.getTime()) &&
        typeof days === 'number' &&
        Number.isInteger(days) &&
        days >= 0 &&
        (termsVersion == null ||
            (typeof termsVersion === 'string' && TERMS_VERSION_PATTERN.test(termsVersion)));
    if (!complete) {
        throw new Error(
            `${where} records an agreement that is incomplete or holds a value no agreement ` +
                `could: terms ${JSON.stringify(termsVersion)}, ${JSON.stringify(days)} days of ` +
                `notice, agreed ${JSON.stringify(agreedAt)}.`,
        );
    }
    return { termsVersion: termsVersion ?? null, cancellationNoticeDays: days, agreedAt };
}

/** The columns in which a scheduled change, or a booking's scheduled switch, holds its agreement. */
export function pendingAgreementColumns(agreement: ContractAgreement | null): {
    pendingTermsVersion: string | null;
    pendingCancellationNoticeDays: number | null;
    pendingAgreedAt: Date | null;
} {
    return {
        pendingTermsVersion: agreement?.termsVersion ?? null,
        pendingCancellationNoticeDays: agreement?.cancellationNoticeDays ?? null,
        pendingAgreedAt: agreement?.agreedAt ?? null,
    };
}

/** The columns in which a booking holds what was agreed when it was made. */
export function bookingAgreementColumns(agreement: ContractAgreement | null): {
    agreedTermsVersion: string | null;
    agreedCancellationNoticeDays: number | null;
    agreedAt: Date | null;
} {
    return {
        agreedTermsVersion: agreement?.termsVersion ?? null,
        agreedCancellationNoticeDays: agreement?.cancellationNoticeDays ?? null,
        agreedAt: agreement?.agreedAt ?? null,
    };
}
