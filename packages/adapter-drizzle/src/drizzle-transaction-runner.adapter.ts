import { Inject, Injectable, Optional } from '@nestjs/common';
import { concurrencyGateOf, type TransactionContext, type TransactionRunner } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';

/** How the platform's transactions run against the pool. */
export interface DrizzleTransactionOptions {
    /**
     * Most transactions open at once; the rest wait their turn in arrival
     * order. Set it below your pool's `max` and keep the difference for the
     * statements that run outside a transaction — the platform takes row locks
     * inside its transactions and then reads further, and with every
     * connection held by a transaction the reads they wait on cannot get one.
     * The pool size minus five is a sound start. Unset, nothing is bounded.
     * Runners built from one options object share one bound, so pass the same
     * object to every one rather than a copy each.
     * Counted is what runs through `run`; a repository called without a
     * transaction opens its own on its own handle, and is not.
     * How long a transaction or a connection wait may take is the pool's own
     * setting (`connectionTimeoutMillis`, `statement_timeout`).
     */
    maxConcurrent?: number;
}

/**
 * Optional DI token for registering the runner through Nest directly.
 * `drizzlePersistence({ transactions })` passes the options itself.
 */
export const DRIZZLE_TRANSACTION_OPTIONS_TOKEN = Symbol.for(
    'saasicat/adapter-drizzle/DrizzleTransactionOptions',
);

/**
 * `TransactionRunner` over `db.transaction`. The Drizzle transaction handle
 * is passed through as the opaque `TransactionContext`; every repository in
 * this package resolves it back via `resolveDb`.
 */
@Injectable()
export class DrizzleTransactionRunner implements TransactionRunner {
    private readonly admit: <T>(work: () => Promise<T>) => Promise<T>;

    constructor(
        @Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient,
        @Optional()
        @Inject(DRIZZLE_TRANSACTION_OPTIONS_TOKEN)
        options?: DrizzleTransactionOptions,
    ) {
        this.admit =
            options?.maxConcurrent === undefined
                ? (work) => work()
                : concurrencyGateOf(options, options.maxConcurrent);
    }

    async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
        return this.admit(() => this.db.transaction((tx) => fn(tx)));
    }
}
