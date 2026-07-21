import type { TransactionContext } from '@saasicat/types';
import type { PrismaTxLike } from './prisma-client-token.js';

/**
 * Resolves the client a repository call runs against: the opaque
 * `TransactionContext` when the caller opened a transaction, otherwise the
 * injected root client. The cast is the single place where the opaque
 * context becomes Prisma-shaped — valid because `PrismaTransactionRunner`
 * is the only producer of contexts in this adapter.
 */
export function resolveClient(client: PrismaTxLike, tx?: TransactionContext): PrismaTxLike {
    return (tx as PrismaTxLike | undefined) ?? client;
}

/** Narrows a JSON column to the platform quota object; non-objects become {}. */
export function toQuotaMap(value: unknown): Record<string, number> {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, number>;
    }
    return {};
}

/** Narrows a JSON column to a string array; non-arrays become []. */
export function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? (value as string[]) : [];
}
