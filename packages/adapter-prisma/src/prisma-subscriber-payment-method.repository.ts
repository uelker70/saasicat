import { Inject, Injectable } from '@nestjs/common';
import type {
    CanonicalSubscriberPaymentMethodRow,
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
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface PaymentMethodPrisma {
    subscriberPaymentMethod: PrismaModelDelegateLike<CanonicalSubscriberPaymentMethodRow> & {
        /** `INSERT … ON CONFLICT DO NOTHING RETURNING *`, which PostgreSQL supports. */
        createManyAndReturn(args: {
            data: Omit<CanonicalSubscriberPaymentMethodRow, 'id' | 'createdAt'>[];
            skipDuplicates: boolean;
        }): Promise<CanonicalSubscriberPaymentMethodRow[]>;
    };
    subscriberPaymentMethodSetup: PrismaModelDelegateLike<unknown>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** Root-client fields used directly: the delegate and the interactive transaction. */
interface PaymentMethodRepositoryClient {
    subscriberPaymentMethod: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/** `SubscriberPaymentMethodRepository` against `subscriber_payment_methods`. */
@Injectable()
export class PrismaSubscriberPaymentMethodRepository implements SubscriberPaymentMethodRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: PaymentMethodRepositoryClient,
    ) {}

    private db(tx?: TransactionContext): PaymentMethodPrisma {
        return (tx ?? this.prisma) as unknown as PaymentMethodPrisma;
    }

    /** On the caller's transaction when there is one, otherwise in one of its own. */
    private inTransaction<T>(
        tx: TransactionContext | undefined,
        fn: (db: PaymentMethodPrisma) => Promise<T>,
    ): Promise<T> {
        if (tx) return fn(this.db(tx));
        return this.prisma.$transaction((own) => fn(own as PaymentMethodPrisma));
    }

    async recordConfirmed(
        data: RecordSubscriberPaymentMethodData,
        tx?: TransactionContext,
    ): Promise<RecordSubscriberPaymentMethodResult> {
        return this.inTransaction(tx, async (db) => {
            // Held until the transaction ends: a second confirmation for the
            // same subscriber waits here and then reads what this one wrote.
            const locked =
                await db.$queryRaw`SELECT "id" FROM "subscribers" WHERE "id" = ${data.subscriberId} FOR UPDATE`;
            if (!Array.isArray(locked) || locked.length === 0) {
                throw new Error(
                    `Subscriber '${data.subscriberId}' does not exist; its payment method cannot be recorded.`,
                );
            }
            const recorded = await db.subscriberPaymentMethod.findUnique({
                where: {
                    gatewayAccount_paymentMethodRef: {
                        gatewayAccount: data.gatewayAccount,
                        paymentMethodRef: data.paymentMethodRef,
                    },
                },
            });
            if (recorded) {
                refuseForeignPaymentMethodReference(recorded, data.subscriberId);
                return {
                    method: toSubscriberPaymentMethodRecord(recorded),
                    outcome: 'already-recorded',
                };
            }
            const active = await db.subscriberPaymentMethod.findFirst({
                where: { subscriberId: data.subscriberId, status: 'ACTIVE' },
            });
            // A confirmation that arrived late: the payment method in use was
            // confirmed after this one, so this one is filed as already replaced.
            const replacedOnArrival =
                active && active.confirmedAt.getTime() > data.confirmedAt.getTime()
                    ? active.confirmedAt
                    : null;
            const claimed = await this.claimReference(db, {
                ...subscriberPaymentMethodColumns(data),
                status: 'REPLACED',
                replacedAt: replacedOnArrival ?? data.confirmedAt,
            });
            if (replacedOnArrival) {
                return { method: toSubscriberPaymentMethodRecord(claimed), outcome: 'superseded' };
            }
            if (active) {
                await db.subscriberPaymentMethod.update({
                    where: { id: active.id },
                    data: { status: 'REPLACED', replacedAt: data.confirmedAt },
                });
            }
            const inUse = await db.subscriberPaymentMethod.update({
                where: { id: claimed.id },
                data: { status: 'ACTIVE', replacedAt: null },
            });
            return { method: toSubscriberPaymentMethodRecord(inUse), outcome: 'activated' };
        });
    }

    /**
     * Takes the reference for this subscriber, or refuses it to them.
     *
     * The first write of the three, and the only one that can be refused — so a
     * refusal leaves the caller's transaction as it found it, whichever way the
     * caller opened it. `skipDuplicates` is `ON CONFLICT DO NOTHING`: the row
     * the read above could not see, because the transaction holding it had not
     * committed, answers here instead, and answers by waiting for that
     * transaction rather than by raising.
     *
     * It is written `REPLACED` because the seat a subscriber's one `ACTIVE`
     * payment method occupies may still be taken; `recordConfirmed` gives it
     * the status it keeps once the seat is free. Nothing outside the
     * transaction sees the difference.
     *
     * `skipDuplicates` names no conflict target — Prisma has none to give — so
     * it suppresses **every** unique key on the table, not just the reference's.
     * In the canonical schema that is the only one this claim can meet: the
     * primary key is a uuid made here, and the partial index that gives a
     * subscriber one `ACTIVE` payment method does not contain a `REPLACED` row.
     * A consumer's schema is a copy of the fragment that it may add to, and
     * `saasicat schema check` reports what is missing rather than forbidding
     * what was added — so the cause is read back rather than assumed, and a
     * claim refused by some other key says that instead of naming a subscriber
     * it never looked for.
     */
    private async claimReference(
        db: PaymentMethodPrisma,
        row: Omit<CanonicalSubscriberPaymentMethodRow, 'id' | 'createdAt'>,
    ): Promise<CanonicalSubscriberPaymentMethodRow> {
        const [claimed] = await db.subscriberPaymentMethod.createManyAndReturn({
            data: [row],
            skipDuplicates: true,
        });
        if (claimed) return claimed;
        // The claim skips only against a row that committed, so the holder is
        // there to be found — unless something other than the reference's key
        // refused it.
        const holder = await db.subscriberPaymentMethod.findUnique({
            where: {
                gatewayAccount_paymentMethodRef: {
                    gatewayAccount: row.gatewayAccount,
                    paymentMethodRef: row.paymentMethodRef,
                },
            },
        });
        if (!holder) {
            throw new Error(
                `Payment method '${row.paymentMethodRef}' of account '${row.gatewayAccount}' was not ` +
                    'written, and no payment method holds that reference. Some other unique key on ' +
                    'subscriber_payment_methods refused the row; the canonical schema has none that could.',
            );
        }
        throw new ForeignPaymentMethodReferenceError(row.gatewayAccount, row.paymentMethodRef);
    }

    async findActive(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentMethodRecord | null> {
        const row = await this.db(tx).subscriberPaymentMethod.findFirst({
            where: { subscriberId, status: 'ACTIVE' },
        });
        return row ? toSubscriberPaymentMethodRecord(row) : null;
    }

    async findByReference(
        reference: SubscriberPaymentMethodReference,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentMethodRecord | null> {
        // `findFirst` over the unique key plus the subscriber, rather than
        // `findUnique` and a check on what came back: the subscriber belongs in
        // the statement, so a policy on the table and this predicate bound the
        // same read the same way.
        const row = await this.db(tx).subscriberPaymentMethod.findFirst({
            where: {
                subscriberId: reference.subscriberId,
                gatewayAccount: reference.gatewayAccount,
                paymentMethodRef: reference.paymentMethodRef,
            },
        });
        return row ? toSubscriberPaymentMethodRecord(row) : null;
    }

    async accountsInUse(): Promise<string[]> {
        const rows = await this.db().subscriberPaymentMethod.findMany({
            where: { status: 'ACTIVE' },
            distinct: ['gatewayAccount'],
            select: { gatewayAccount: true },
            orderBy: { gatewayAccount: 'asc' },
        });
        return rows.map((row) => row.gatewayAccount);
    }

    async recordSetup(
        data: SubscriberPaymentMethodSetupData,
        tx?: TransactionContext,
    ): Promise<void> {
        await this.db(tx).subscriberPaymentMethodSetup.create({
            data: {
                subscriberId: data.subscriberId,
                gatewayAccount: data.gatewayAccount,
                sessionRef: data.sessionRef,
                customerRef: data.customerRef,
                startedAt: data.startedAt,
            },
        });
    }

    async completeSetup(
        match: SubscriberPaymentMethodSetupMatch,
        completedAt: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        // One conditional write: of two confirmations for one setup, the second
        // finds `completedAt` set and changes nothing.
        const { count } = await this.db(tx).subscriberPaymentMethodSetup.updateMany({
            where: {
                gatewayAccount: match.gatewayAccount,
                sessionRef: match.sessionRef,
                subscriberId: match.subscriberId,
                completedAt: null,
            },
            data: { completedAt },
        });
        return count === 1;
    }
}
