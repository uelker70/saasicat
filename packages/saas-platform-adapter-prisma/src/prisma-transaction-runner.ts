import { Inject, Injectable } from '@nestjs/common';
import type { TransactionContext, TransactionRunner } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/**
 * `TransactionRunner` over `prisma.$transaction`. The interactive transaction
 * client is passed through as the opaque `TransactionContext`; every
 * repository in this package resolves it back via `resolveClient`.
 */
@Injectable()
export class PrismaTransactionRunner implements TransactionRunner {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
        return this.prisma.$transaction((tx) => fn(tx));
    }
}
