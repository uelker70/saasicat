// What an operator's correction of a subscriber sends, read off the form: only
// the fields that changed, never an empty reason. Framework-free, so the rule
// is one function the two dialogs share and a test calls without mounting them.

import type { AdminTenantSubscriber } from '@saasicat/core';

import type {
    SubscriberBusinessStatusInput,
    SubscriberIdentityCorrectionInput,
} from '../../client/resources/tenants.resource.js';

/** The longest reason the platform takes for a correction. */
export const REASON_MAX_LENGTH = 500;

type Held = Pick<
    NonNullable<AdminTenantSubscriber['subscriber']>,
    'legalName' | 'vatId' | 'taxNumber'
>;

/** A blank tax identifier clears it; anything else is sent as typed, trimmed. */
const identifierOf = (typed: string): string | null => (typed.trim() === '' ? null : typed.trim());

/**
 * The correction the form describes, or `null` while it describes none: nothing
 * changed, the legal name is blank, or there is no reason.
 */
export function identityCorrectionOf(
    held: Held,
    form: { legalName: string; vatId: string; taxNumber: string; reason: string },
): SubscriberIdentityCorrectionInput | null {
    const reason = form.reason.trim();
    const legalName = form.legalName.trim();
    if (reason === '' || legalName === '') return null;
    const correction: SubscriberIdentityCorrectionInput = { reason };
    if (legalName !== held.legalName) correction.legalName = legalName;
    const vatId = identifierOf(form.vatId);
    if (vatId !== held.vatId) correction.vatId = vatId;
    const taxNumber = identifierOf(form.taxNumber);
    if (taxNumber !== held.taxNumber) correction.taxNumber = taxNumber;
    return Object.keys(correction).length > 1 ? correction : null;
}

/** The change of business status the form describes, or `null` while it describes none. */
export function businessStatusChangeOf(
    held: boolean | null,
    form: { business: boolean | null; reason: string },
): SubscriberBusinessStatusInput | null {
    const reason = form.reason.trim();
    if (reason === '' || form.business === held) return null;
    return { business: form.business, reason };
}
