// The subscriber an invoice opened for cancelling names, read as its record
// holds it now, so the cancel dialog offers the record's values for the
// replacement wherever it opens — in the register as in the subscriber's
// record, which has the record at hand already.

import type { AdminSubscriberDetails } from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

/** The operation the party is read with, already bound to the shell's client. */
export type CancellationPartyResource = Pick<Bound<(typeof subscribersResource)['ops']>, 'record'>;

/**
 * The details of the subscriber `subscriberId` names, read each time it names
 * one after naming another or none, and `null` while it names none: a caller
 * that names none while no dialog is open has each opening read the record
 * anew.
 */
export function useCancellationParty(
    subscribers: CancellationPartyResource,
    subscriberId: () => string | null,
): AsyncData<AdminSubscriberDetails | null> {
    return useAsyncData<AdminSubscriberDetails | null>(
        async () => {
            const id = subscriberId();
            return id === null ? null : (await subscribers.record(id)).subscriber;
        },
        { initial: null, immediate: false, subject: subscriberId },
    );
}
