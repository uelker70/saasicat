import { Inject, Injectable } from '@nestjs/common';
import type { TransactionContext, TransactionRunner } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';

/**
 * `TransactionRunner` over `db.transaction`. The Drizzle transaction handle
 * is passed through as the opaque `TransactionContext`; every repository in
 * this package resolves it back via `resolveDb`.
 */
@Injectable()
export class DrizzleTransactionRunner implements TransactionRunner {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
        return this.db.transaction((tx) => fn(tx));
    }
}
