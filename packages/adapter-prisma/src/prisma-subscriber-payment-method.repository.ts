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
    refuseForeignPaymentMethodReference,
    subscriberPaymentMethodColumns,
    toSubscriberPaymentMethodRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface PaymentMethodPrisma {
    subscriberPaymentMethod: PrismaModelDelegateLike<CanonicalSubscriberPaymentMethodRow>;
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
            if (active && active.confirmedAt.getTime() > data.confirmedAt.getTime()) {
                const created = await db.subscriberPaymentMethod.create({
                    data: {
                        ...subscriberPaymentMethodColumns(data),
                        status: 'REPLACED',
                        replacedAt: active.confirmedAt,
                    },
                });
                return { method: toSubscriberPaymentMethodRecord(created), outcome: 'superseded' };
            }
            if (active) {
                await db.subscriberPaymentMethod.update({
                    where: { id: active.id },
                    data: { status: 'REPLACED', replacedAt: data.confirmedAt },
                });
            }
            const created = await db.subscriberPaymentMethod.create({
                data: {
                    ...subscriberPaymentMethodColumns(data),
                    status: 'ACTIVE',
                    replacedAt: null,
                },
            });
            return { method: toSubscriberPaymentMethodRecord(created), outcome: 'activated' };
        });
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
