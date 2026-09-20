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
    foreignPaymentMethodReference,
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
                    outcome: 'already-recorded',
                };
            }
            const [active] = await db
                .select()
                .from(subscriberPaymentMethods)
                .where(this.activeOf(data.subscriberId))
                .limit(1);
            const columns = { ...subscriberPaymentMethodColumns(data), id: randomUUID() };
            if (active && active.confirmedAt.getTime() > data.confirmedAt.getTime()) {
                const created = await this.insert(db, {
                    ...columns,
                    status: 'REPLACED',
                    replacedAt: active.confirmedAt,
                });
                return { method: toSubscriberPaymentMethodRecord(created), outcome: 'superseded' };
            }
            if (active) {
                await db
                    .update(subscriberPaymentMethods)
                    .set({ status: 'REPLACED', replacedAt: data.confirmedAt })
                    .where(eq(subscriberPaymentMethods.id, active.id));
            }
            const created = await this.insert(db, {
                ...columns,
                status: 'ACTIVE',
                replacedAt: null,
            });
            return { method: toSubscriberPaymentMethodRecord(created), outcome: 'activated' };
        });
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

    /**
     * Writes the row, or gives the reference's owner the refusal the read above
     * gives — the read cannot see a row a concurrent transaction has not
     * committed, and the unique key is what catches those.
     */
    private async insert(db: DrizzleClient, values: typeof subscriberPaymentMethods.$inferInsert) {
        try {
            const [created] = await db.insert(subscriberPaymentMethods).values(values).returning();
            return created;
        } catch (error) {
            if (!violatesReferenceKey(error)) throw error;
            throw foreignPaymentMethodReference(values.gatewayAccount, values.paymentMethodRef);
        }
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

/** The two columns the reference's unique key is on, read off the table rather than spelled again. */
const REFERENCE_KEY_COLUMNS = [
    subscriberPaymentMethods.gatewayAccount.name,
    subscriberPaymentMethods.paymentMethodRef.name,
];

/**
 * Whether PostgreSQL refused a write because the reference's unique key already
 * holds the pair.
 *
 * Narrow on purpose: the table carries two other unique keys — its primary key,
 * and the partial index that gives a subscriber one `ACTIVE` payment method —
 * and neither means what this one means. Drizzle wraps the driver's error, so
 * the code and the constraint are read off `cause`; the constraint is matched by
 * the columns it is on rather than by its name, which a consumer's schema may
 * spell differently. A violation this does not recognise is rethrown as it came.
 */
function violatesReferenceKey(error: unknown): boolean {
    const driver = (error as { cause?: { code?: unknown; constraint?: unknown } } | null)?.cause;
    if (driver?.code !== '23505') return false;
    const constraint = String(driver.constraint ?? '');
    return REFERENCE_KEY_COLUMNS.every((column) => constraint.includes(column));
}
