import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RlsBypassPort } from '@saasicat/types';

/**
 * Default-Implementation für `RlsBypassPort` via `node:async_hooks`.
 *
 * Setzt `bypass: true` für die Dauer des übergebenen Callbacks im aktuellen
 * Async-Context. Dein PrismaService liest `isBypassActive()` (z. B. in einer
 * Prisma-Middleware oder einem Interceptor) und setzt `SET LOCAL row_security
 * = off` in der aktuellen Transaktion, wenn aktiv.
 *
 * Beispiel-Middleware:
 *
 * ```ts
 * constructor(private readonly rls: AsyncLocalRlsBypassAdapter) {
 *     super();
 *     this.$use(async (params, next) => {
 *         if (this.rls.isBypassActive() && params.action.startsWith('find')) {
 *             // Bypass-Modus aktiv — RLS für diese Query deaktivieren.
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
     * `true` während der Ausführung eines `runWithBypass(...)`-Callbacks.
     * Im PrismaService oder Interceptor abfragen.
     */
    isBypassActive(): boolean {
        return this.storage.getStore()?.bypass === true;
    }
}
