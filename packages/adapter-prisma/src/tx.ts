import { readQuotaRecord } from '@saasicat/core';
import type { TransactionContext } from '@saasicat/core';
/**
 * Resolves the client a repository call runs against: the opaque
 * `TransactionContext` when the caller opened a transaction, otherwise the
 * injected root client. The cast is the single place where the opaque
 * context becomes Prisma-shaped — valid because `PrismaTransactionRunner`
 * is the only producer of contexts in this adapter.
 */
export function resolveClient<C>(client: C, tx?: TransactionContext): C {
    return (tx as C | undefined) ?? client;
}

/** Narrows a JSON column to the platform quota object; non-objects become {}. */
export function toQuotaMap(value: unknown): Record<string, number> {
    return readQuotaRecord(value);
}

/** Narrows a JSON column to a string array; non-arrays become []. */
export function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? (value as string[]) : [];
}
