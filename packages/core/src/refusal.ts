import type { PlatformErrorCode } from './error-codes.js';
import { ERROR_MESSAGES_EN, formatErrorMessage, resolveErrorMessage } from './error-messages.js';
import { PersistenceRefusal, type PersistenceRefusalReason } from './errors.js';
import { dayInZone } from './zoned-day.js';

/**
 * A refusal worded by the shipped English catalogue, so that it reads the same
 * as the answer the platform's own check gives for the case before it writes.
 */
export function refusal(
    code: PlatformErrorCode,
    reason: PersistenceRefusalReason,
    params: Readonly<Record<string, unknown>>,
    dayMoments: Readonly<Record<string, Date>> = {},
): PersistenceRefusal {
    return new PersistenceRefusal(
        code,
        reason,
        formatErrorMessage(ERROR_MESSAGES_EN[code], params),
        params,
        dayMoments,
    );
}

/** What a refusal says on the wire: its code, its English sentence and its values. */
export type RefusalBody = Pick<PersistenceRefusal, 'code' | 'message' | 'params'> & {
    /** The names in `params` whose values are days (`writeDayParams`). */
    readonly dayParams?: readonly string[];
};

/**
 * `refusal` as the platform answers it in an installation whose zone is
 * `timeZone`: each value it names a day of a moment for is that moment's day
 * there, said to be a day, and the English sentence names those days too. A
 * refusal that names no day is answered as it came.
 */
export function refusalBodyIn(refusal: PersistenceRefusal, timeZone: string): RefusalBody {
    const { code, message } = refusal;
    // A refusal built by another copy of core — an adapter that brought an
    // older one along — carries no moments, and `isPersistenceRefusal` accepts
    // it all the same: it is answered as it came.
    const moments = refusal.dayMoments ?? {};
    const names = Object.keys(moments);
    if (names.length === 0) return { code, message, params: refusal.params };
    const params = { ...refusal.params };
    for (const name of names) {
        const moment = moments[name];
        if (moment) params[name] = dayInZone(moment, timeZone);
    }
    return {
        code,
        message: resolveErrorMessage({ code, message, params }, {}, ERROR_MESSAGES_EN),
        params,
        dayParams: names,
    };
}
