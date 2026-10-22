// What a contract records as agreed: the version of the operator's terms and
// the days of notice the subscriber agreed to, and when (`ContractAgreement`,
// `SC-CFG-038`, `SC-CANC-026`). One rule for every writer of a contract and
// for every place that schedules a change: a change the subscriber makes reads
// the file at that moment; a successor the operator or the platform writes
// keeps what the contract it replaces records; and a change the subscriber
// scheduled records its own agreement, unless they agreed to a later one since.

import type {
    ContractAgreement,
    CreateSubscriptionContractData,
    PlanCatalogSettings,
    SubscriptionContractRecord,
} from '@saasicat/core';

import { NO_NOTICE_PERIOD, noticeDaysFor } from '../billing/cancellation.js';

/** The two settings an agreement is read from. */
export type AgreementSettings = Pick<PlanCatalogSettings, 'tenantBilling' | 'terms'>;

/**
 * What a subscriber agrees to by a change they make at `at`, ending in
 * `billingCycle`: the version of the terms `config/saas.yaml` names and the
 * days of notice it names for that rhythm. Without the settings — a service
 * built directly in a test — no terms and no notice.
 */
export function agreementNamed(
    settings: AgreementSettings | null,
    billingCycle: string,
    at: Date,
): ContractAgreement {
    return {
        termsVersion: settings?.terms?.version ?? null,
        cancellationNoticeDays: noticeDaysFor(
            settings?.tenantBilling.cancellationNoticeDays ?? NO_NOTICE_PERIOD,
            billingCycle,
        ),
        agreedAt: at,
    };
}

/** What `contract` records as agreed. */
export function agreementOf(contract: SubscriptionContractRecord): ContractAgreement {
    return {
        termsVersion: contract.termsVersion,
        cancellationNoticeDays: contract.cancellationNoticeDays,
        agreedAt: contract.agreedAt,
    };
}

/**
 * Where the agreement of a successor comes from: `kept` from the contract it
 * replaces, for one the operator or the platform writes without the
 * subscriber; the agreement a change recorded when the subscriber scheduled
 * it, for one written when that change takes effect; left out, the file's now,
 * for a change the subscriber makes now.
 */
export type SuccessorAgreement = 'kept' | ContractAgreement;

/**
 * What a successor of `previous` records as agreed, `named` being what the
 * file names now.
 *
 * A scheduled change's agreement gives way to that of the contract in force
 * where the subscriber agreed to it later: by agreeing to newer terms in
 * between they agreed to them for the whole contract. The days of notice are
 * then the later ones as well, unless the change moves the rhythm — the days
 * the contract in force records are those of the rhythm it leaves.
 */
export function successorAgreement(
    previous: SubscriptionContractRecord | null,
    next: CreateSubscriptionContractData,
    source: SuccessorAgreement | undefined,
    named: ContractAgreement,
): ContractAgreement {
    if (source === undefined || !previous) {
        return source === undefined || source === 'kept' ? named : source;
    }
    const sameRhythm = rhythmOf(previous.priceSnapshot) === rhythmOf(next.priceSnapshot);
    if (source === 'kept') {
        if (!sameRhythm) {
            throw new Error(
                `A successor that keeps what contract '${previous.id}' agreed stays in its rhythm, ` +
                    `${rhythmOf(previous.priceSnapshot)}, and this one is ` +
                    `${rhythmOf(next.priceSnapshot)}.`,
            );
        }
        return agreementOf(previous);
    }
    if (previous.agreedAt.getTime() <= source.agreedAt.getTime()) return source;
    return {
        termsVersion: previous.termsVersion,
        cancellationNoticeDays: sameRhythm
            ? previous.cancellationNoticeDays
            : source.cancellationNoticeDays,
        agreedAt: previous.agreedAt,
    };
}

/**
 * The latest of what the subscriber agreed to by `bookings`, for the contract
 * written for them later; undefined where none of them recorded it.
 */
export function latestAgreementOf(
    bookings: readonly { agreement: ContractAgreement | null }[],
): ContractAgreement | undefined {
    let latest: ContractAgreement | undefined;
    for (const { agreement } of bookings) {
        if (agreement && (!latest || agreement.agreedAt > latest.agreedAt)) latest = agreement;
    }
    return latest;
}

function rhythmOf(snapshot: { billingCycle: string }): string {
    return snapshot.billingCycle.toLowerCase();
}
