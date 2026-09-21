import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type {
    RecordSubscriberPaymentMethodData,
    RecordSubscriberPaymentMethodResult,
    SubscriberPaymentMethodRecord,
    SubscriberPaymentMethodReference,
    SubscriberPaymentMethodRepository,
    SubscriberPaymentMethodSetupData,
    SubscriberPaymentMethodSetupMatch,
    TransactionContext,
} from '@saasicat/core';
import {
    ForeignPaymentMethodReferenceError,
    refuseForeignPaymentMethodReference,
    subscriberPaymentMethodColumns,
    toSubscriberPaymentMethodRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { subscriberPaymentMethodSetups, subscriberPaymentMethods, subscribers } from './schema.js';

/** `SubscriberPaymentMethodRepository` against `subscriber_payment_methods`. */
@Injectable()
export class DrizzleSubscriberPaymentMethodRepository implements SubscriberPaymentMethodRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async recordConfirmed(
        data: RecordSubscriberPaymentMethodData,
        tx?: TransactionContext,
    ): Promise<RecordSubscriberPaymentMethodResult> {
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            // Held until the transaction ends: a second confirmation for the
            // same subscriber waits here and then reads what this one wrote.
            const locked = await db
                .select({ id: subscribers.id })
                .from(subscribers)
                .where(eq(subscribers.id, data.subscriberId))
                .for('update')
                .limit(1);
            if (locked.length === 0) {
                throw new Error(
                    `Subscriber '${data.subscriberId}' does not exist; its payment method cannot be recorded.`,
                );
            }
            const [recorded] = await db
                .select()
                .from(subscriberPaymentMethods)
                .where(this.byReference(data.gatewayAccount, data.paymentMethodRef))
                .limit(1);
            if (recorded) {
                refuseForeignPaymentMethodReference(recorded, data.subscriberId);
                return {
                    method: toSubscriberPaymentMethodRecord(recorded),
                    outcome: 'already-recorded' as const,
                };
            }
            const [active] = await db
                .select()
                .from(subscriberPaymentMethods)
                .where(this.activeOf(data.subscriberId))
                .limit(1);
            // A confirmation that arrived late: the payment method in use was
            // confirmed after this one, so this one is filed as already replaced.
            const replacedOnArrival =
                active && active.confirmedAt.getTime() > data.confirmedAt.getTime()
                    ? active.confirmedAt
                    : null;
            const claimed = await this.claimReference(db, {
                ...subscriberPaymentMethodColumns(data),
                id: randomUUID(),
                status: 'REPLACED',
                replacedAt: replacedOnArrival ?? data.confirmedAt,
            });
            if (replacedOnArrival) {
                return {
                    method: toSubscriberPaymentMethodRecord(claimed),
                    outcome: 'superseded' as const,
                };
            }
            if (active) {
                await db
                    .update(subscriberPaymentMethods)
                    .set({ status: 'REPLACED', replacedAt: data.confirmedAt })
                    .where(eq(subscriberPaymentMethods.id, active.id));
            }
            const [inUse] = await db
                .update(subscriberPaymentMethods)
                .set({ status: 'ACTIVE', replacedAt: null })
                .where(eq(subscriberPaymentMethods.id, claimed.id))
                .returning();
            return {
                method: toSubscriberPaymentMethodRecord(inUse),
                outcome: 'activated' as const,
            };
        });
    }

    /**
     * Takes the reference for this subscriber, or refuses it to them.
     *
     * The first write of the three, and the only one that can be refused — so a
     * refusal leaves the caller's transaction as it found it, whichever way the
     * caller opened it. `onConflictDoNothing` on the reference's own columns is
     * what answers: the row the read above could not see, because the
     * transaction holding it had not committed, is waited for here rather than
     * raised as a driver error, which every driver spells differently.
     *
     * It is written `REPLACED` because the seat a subscriber's one `ACTIVE`
     * payment method occupies may still be taken; `recordConfirmed` gives it
     * the status it keeps once the seat is free. Nothing outside the
     * transaction sees the difference.
     */
    private async claimReference(
        db: DrizzleClient,
        values: typeof subscriberPaymentMethods.$inferInsert,
    ) {
        const [claimed] = await db
            .insert(subscriberPaymentMethods)
            .values(values)
            .onConflictDoNothing({
                target: [
                    subscriberPaymentMethods.gatewayAccount,
                    subscriberPaymentMethods.paymentMethodRef,
                ],
            })
            .returning();
        if (!claimed) {
            throw new ForeignPaymentMethodReferenceError(
                values.gatewayAccount,
                values.paymentMethodRef,
            );
        }
        return claimed;
    }

    async findActive(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentMethodRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(subscriberPaymentMethods)
            .where(this.activeOf(subscriberId))
            .limit(1);
        return row ? toSubscriberPaymentMethodRecord(row) : null;
    }

    async findByReference(
        reference: SubscriberPaymentMethodReference,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentMethodRecord | null> {
        // The subscriber is part of the predicate rather than a check on what
        // came back, so a policy on the table and this statement bound the same
        // read the same way.
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(subscriberPaymentMethods)
            .where(
                and(
                    eq(subscriberPaymentMethods.subscriberId, reference.subscriberId),
                    this.byReference(reference.gatewayAccount, reference.paymentMethodRef),
                ),
            )
            .limit(1);
        return row ? toSubscriberPaymentMethodRecord(row) : null;
    }

    async accountsInUse(): Promise<string[]> {
        const rows = await this.db
            .selectDistinct({ gatewayAccount: subscriberPaymentMethods.gatewayAccount })
            .from(subscriberPaymentMethods)
            .where(eq(subscriberPaymentMethods.status, 'ACTIVE'))
            .orderBy(asc(subscriberPaymentMethods.gatewayAccount));
        return rows.map((row) => row.gatewayAccount);
    }

    async recordSetup(
        data: SubscriberPaymentMethodSetupData,
        tx?: TransactionContext,
    ): Promise<void> {
        await resolveDb(this.db, tx).insert(subscriberPaymentMethodSetups).values({
            id: randomUUID(),
            subscriberId: data.subscriberId,
            gatewayAccount: data.gatewayAccount,
            sessionRef: data.sessionRef,
            customerRef: data.customerRef,
            startedAt: data.startedAt,
        });
    }

    async completeSetup(
        match: SubscriberPaymentMethodSetupMatch,
        completedAt: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        // One conditional write: of two confirmations for one setup, the second
        // finds `completedAt` set and changes nothing.
        const completed = await resolveDb(this.db, tx)
            .update(subscriberPaymentMethodSetups)
            .set({ completedAt })
            .where(
                and(
                    eq(subscriberPaymentMethodSetups.gatewayAccount, match.gatewayAccount),
                    eq(subscriberPaymentMethodSetups.sessionRef, match.sessionRef),
                    eq(subscriberPaymentMethodSetups.subscriberId, match.subscriberId),
                    isNull(subscriberPaymentMethodSetups.completedAt),
                ),
            )
            .returning({ id: subscriberPaymentMethodSetups.id });
        return completed.length === 1;
    }

    private activeOf(subscriberId: string) {
        return and(
            eq(subscriberPaymentMethods.subscriberId, subscriberId),
            eq(subscriberPaymentMethods.status, 'ACTIVE'),
        );
    }

    private byReference(gatewayAccount: string, paymentMethodRef: string) {
        return and(
            eq(subscriberPaymentMethods.gatewayAccount, gatewayAccount),
            eq(subscriberPaymentMethods.paymentMethodRef, paymentMethodRef),
        );
    }
}
