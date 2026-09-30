import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RlsBypassPort } from '@saasicat/core';

/**
 * `RlsBypassPort` over `node:async_hooks`: `runWithBypass` marks the call it
 * wraps, and `isBypassActive()` says whether the current async context is
 * inside one. It lifts nothing — the Drizzle bundle does not lift a row
 * policy — so without row policies it runs the work as it is, and with them
 * an installation binds a port of its own.
 *
 * The same class as the adapter-prisma one, kept per adapter because a few
 * stable, dependency-free lines do not justify a cross-adapter dependency.
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

    /** `true` during the execution of a `runWithBypass(...)` callback. */
    isBypassActive(): boolean {
        return this.storage.getStore()?.bypass === true;
    }
}
