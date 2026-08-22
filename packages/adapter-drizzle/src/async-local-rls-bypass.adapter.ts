import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RlsBypassPort } from '@saasicat/types';

/**
 * Default implementation of `RlsBypassPort` via `node:async_hooks` — sets
 * `bypass: true` for the duration of the given callback in the current
 * async context. Your database layer reads `isBypassActive()` and issues
 * `SET LOCAL row_security = off` in the current transaction when active.
 *
 * Identical to the adapter-prisma implementation — kept per-adapter instead
 * of a shared package because 15 stable, dependency-free lines do not
 * justify a cross-adapter dependency.
 */
@Injectable()
export class AsyncLocalRlsBypassAdapter implements RlsBypassPort {
    private readonly storage = new AsyncLocalStorage<{ bypass: true }>();

    async runWithBypass<T>(fn: () => Promise<T>): Promise<T> {
        return this.storage.run({ bypass: true }, fn);
    }

    /** `true` during the execution of a `runWithBypass(...)` callback. */
    isBypassActive(): boolean {
        return this.storage.getStore()?.bypass === true;
    }
}
