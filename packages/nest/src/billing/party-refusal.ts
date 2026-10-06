import { identityGapsOf } from '../subscriber/subscriber-details.js';
import { isTaxNotSupported } from '../tax/tax-treatments.js';

/** Why a scheduled move found no contract it may write for the tenant's subscriber. */
export type PartyRefusal = 'no-party' | 'identity-incomplete' | 'tax-not-supported';

/**
 * The reason a move records for a refusal of `assertPartyFor`, and what its
 * audit entry carries beside it. An incomplete address is named with its empty
 * fields: the tenant has a subscriber, and completing the address is what lets
 * the next run move it.
 */
export function partyRefusalOf(error: unknown): {
    reason: PartyRefusal;
    extra: Record<string, unknown>;
} {
    if (isTaxNotSupported(error)) return { reason: 'tax-not-supported', extra: {} };
    const missing = identityGapsOf(error);
    if (missing) return { reason: 'identity-incomplete', extra: { missing } };
    return { reason: 'no-party', extra: {} };
}
