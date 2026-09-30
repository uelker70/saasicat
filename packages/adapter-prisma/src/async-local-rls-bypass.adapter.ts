import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RlsBypassPort } from '@saasicat/core';

/**
 * `RlsBypassPort` over `node:async_hooks`: `runWithBypass` marks the call it
 * wraps, and `isBypassActive()` says whether the current async context is
 * inside one.
 *
 * On its own it lifts nothing — it only knows. What lifts a row policy is a
 * statement run in one transaction with the setting the policy reads, which
 * `PrismaRlsBypass` does for a Prisma client and
 * `prismaPersistence({ rlsIntegration: true })` does for the platform's own
 * statements. Without row policies this is the port to bind, and it runs the
 * work as it is.
 */
@Injectable()
export class AsyncLocalRlsBypassAdapter implements RlsBypassPort {
    private readonly storage = new AsyncLocalStorage<{ bypass: true }>();

    async runWithBypass<T>(fn: () => Promise<T>): Promise<T> {
        // Awaited inside the frame. A query builder's promise is lazy — it
        // runs when it is awaited — and one handed back unawaited would run
        // after the frame has closed, outside the bypass.
        return this.storage.run({ bypass: true }, async () => await fn());
    }

    /**
     * `true` during the execution of a `runWithBypass(...)` callback.
     * Query this in the PrismaService or an interceptor.
     */
    isBypassActive(): boolean {
        return this.storage.getStore()?.bypass === true;
    }
}
