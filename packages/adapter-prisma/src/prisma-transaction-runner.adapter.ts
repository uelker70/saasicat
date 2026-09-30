import { Inject, Injectable, Optional } from '@nestjs/common';
import { concurrencyGateOf, type TransactionContext, type TransactionRunner } from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN } from './prisma-client-token.js';

/** How the platform's interactive transactions run against the pool. */
export interface PrismaTransactionOptions {
    /**
     * Most transactions open at once; the rest wait their turn in arrival
     * order. Set it below your pool size and keep the difference for the
     * statements that run outside a transaction — the platform takes row locks
     * inside its transactions and then reads further, and with every
     * connection held by a transaction the reads they wait on cannot get one.
     * The pool size minus five is a sound start. Unset, nothing is bounded.
     * Every runner on one client shares the bound, however many modules build
     * one. A transaction waits for its place as long as it takes — the wait
     * has no deadline, so a sustained overload queues rather than fails.
     * Counted is what runs through `run`; a repository called without a
     * transaction opens its own on its own handle, and is not.
     */
    maxConcurrent?: number;
    /** Milliseconds a transaction may run (Prisma `timeout`; Prisma's default is 5000). */
    timeout?: number;
    /** Milliseconds to wait for a connection (Prisma `maxWait`; Prisma's default is 2000). */
    maxWait?: number;
}

/**
 * Optional DI token for registering the runner through Nest directly.
 * `prismaPersistence({ transactions })` passes the options itself.
 */
export const PRISMA_TRANSACTION_OPTIONS_TOKEN = Symbol.for(
    'saasicat/adapter-prisma/PrismaTransactionOptions',
);

type TransactionMethod = <T>(
    fn: (tx: unknown) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
) => Promise<T>;

/**
 * `TransactionRunner` over `prisma.$transaction`. The interactive transaction
 * client is passed through as the opaque `TransactionContext`; every
 * repository in this package resolves it back via `resolveClient`.
 */
@Injectable()
export class PrismaTransactionRunner implements TransactionRunner {
    private readonly admit: <T>(work: () => Promise<T>) => Promise<T>;
    private readonly limits: { timeout?: number; maxWait?: number } | undefined;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: Record<'$transaction', unknown>,
        @Optional()
        @Inject(PRISMA_TRANSACTION_OPTIONS_TOKEN)
        options?: PrismaTransactionOptions,
    ) {
        this.admit =
            options?.maxConcurrent === undefined
                ? (work) => work()
                : concurrencyGateOf(prisma, options.maxConcurrent);
        // Only what was set: a key present as `undefined` is not the same as
        // leaving Prisma its default.
        const limits = {
            ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
            ...(options?.maxWait === undefined ? {} : { maxWait: options.maxWait }),
        };
        this.limits = Object.keys(limits).length > 0 ? limits : undefined;
    }

    async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
        const transaction = (this.prisma.$transaction as TransactionMethod).bind(
            this.prisma,
        ) as TransactionMethod;
        return this.admit(() => transaction((tx) => fn(tx as TransactionContext), this.limits));
    }
}
