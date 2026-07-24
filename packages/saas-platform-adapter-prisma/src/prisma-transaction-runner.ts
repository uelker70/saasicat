import { Inject, Injectable } from '@nestjs/common';
import type { TransactionContext, TransactionRunner } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN } from './prisma-client-token.js';

type TransactionMethod = <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;

/**
 * `TransactionRunner` over `prisma.$transaction`. The interactive transaction
 * client is passed through as the opaque `TransactionContext`; every
 * repository in this package resolves it back via `resolveClient`.
 */
@Injectable()
export class PrismaTransactionRunner implements TransactionRunner {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: Record<'$transaction', unknown>,
    ) {}

    async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
        const transaction = (this.prisma.$transaction as TransactionMethod).bind(
            this.prisma,
        ) as TransactionMethod;
        return transaction((tx) => fn(tx as TransactionContext));
    }
}
