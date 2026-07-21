import type { TransactionContext } from '@saasicat/types';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * DI token to which the consumer binds their Drizzle database instance. With
 * the `drizzlePersistence({ db })` bundle the binding happens implicitly;
 * the token remains for manual wiring:
 *
 * ```ts
 * providers: [
 *     { provide: DRIZZLE_DB_TOKEN, useValue: drizzle(pool) },
 *     DrizzleMfaAdapter,
 *     // ...
 * ];
 * ```
 */
export const DRIZZLE_DB_TOKEN = Symbol.for('saasicat/adapter-drizzle/DrizzleDb');

/**
 * Any Drizzle PostgreSQL database — driver-independent (node-postgres,
 * postgres.js, …). The adapters only use the pg-core query builder plus
 * `transaction()`, both shared by every driver.
 */
// drizzle's internal type brands vary per driver/schema generic; `any` here
// keeps every PgDatabase instance assignable without forcing consumers to
// cast. The adapters never rely on the erased schema/driver typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleClient = PgDatabase<PgQueryResultHKT, any, any>;

/**
 * Resolves the client a repository call runs against: the opaque
 * `TransactionContext` when the caller opened a transaction, otherwise the
 * injected root client. The cast is the single place where the opaque
 * context becomes Drizzle-shaped — valid because `DrizzleTransactionRunner`
 * is the only producer of contexts in this adapter.
 */
export function resolveDb(client: DrizzleClient, tx?: TransactionContext): DrizzleClient {
    return (tx as DrizzleClient | undefined) ?? client;
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

/** Escapes LIKE metacharacters so user input matches literally (backslash escape). */
export function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}
