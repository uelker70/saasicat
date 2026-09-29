import { PROMO_ERROR_CODES } from './error-codes.js';
import { PersistenceRefusal } from './errors.js';

/**
 * A code whose name is taken — by a live code, or by a deleted one, since a
 * deleted code keeps its name (`SC-PROMO-028`). The platform checks before it
 * creates; this is what the unique index answers when two creates race past
 * that check.
 */
export function promoCodeTaken(code: string): PersistenceRefusal {
    return new PersistenceRefusal(
        PROMO_ERROR_CODES.PROMO_CODE_ALREADY_EXISTS,
        'moved',
        `Promo code '${code}' is taken.`,
        { promoCode: code },
    );
}
