import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RlsBypassPort } from '@saasicat/types';

/**
 * Default implementation of `RlsBypassPort` via `node:async_hooks`.
 *
 * Sets `bypass: true` for the duration of the given callback in the current
 * async context. Your PrismaService reads `isBypassActive()` (e.g. in a
 * Prisma middleware or an interceptor) and issues `SET LOCAL row_security
 * = off` in the current transaction when active.
 *
 * Example middleware:
 *
 * ```ts
 * constructor(private readonly rls: AsyncLocalRlsBypassAdapter) {
 *     super();
 *     this.$use(async (params, next) => {
 *         if (this.rls.isBypassActive() && params.action.startsWith('find')) {
 *             // Bypass mode active — disable RLS for this query.
 *             await this.$executeRawUnsafe('SET LOCAL row_security = off');
 *         }
 *         return next(params);
 *     });
 * }
 * ```
 */
@Injectable()
export class AsyncLocalRlsBypassAdapter implements RlsBypassPort {
    private readonly storage = new AsyncLocalStorage<{ bypass: true }>();

    async runWithBypass<T>(fn: () => Promise<T>): Promise<T> {
        return this.storage.run({ bypass: true }, fn);
    }

    /**
     * `true` during the execution of a `runWithBypass(...)` callback.
     * Query this in the PrismaService or an interceptor.
     */
    isBypassActive(): boolean {
        return this.storage.getStore()?.bypass === true;
    }
}
