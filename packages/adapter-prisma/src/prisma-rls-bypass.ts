// Lifting a row policy for the statements the platform runs across tenants.
//
// A policy that filters on the tenant hides every other tenant's rows, and a
// platform-wide read or write needs them. PostgreSQL has no per-statement
// switch for that: `row_security = off` makes a query the policy would filter
// fail rather than see more, and a role with BYPASSRLS bypasses every policy
// for every statement it runs. What works is a setting the policy reads, set
// for one transaction:
//
//     USING ("tenantId" = current_setting('app.tenant_id', true)
//            OR current_setting('app.bypass_rls', true) = 'true')
//
// `set_config(…, true)` lasts until the transaction ends, so the statement it
// is meant for has to run in that transaction. A statement outside an
// interactive transaction therefore runs as a batch of two, the setting and
// then the statement. One inside a transaction the platform's runner opened
// runs as it is: the runner made the setting when it opened the transaction
// inside the bypass. A transaction opened outside the bypass cannot take the
// setting later without keeping it for the rest of the transaction, after the
// bypass has ended, so a statement that enters the bypass inside one is
// refused rather than run under a policy that hides what it looks for.

import { AsyncLocalStorage } from 'node:async_hooks';

import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';

/** The setting a policy reads when the shipped bypass is used as it comes. */
export const DEFAULT_RLS_BYPASS_SETTING = 'app.bypass_rls';

/** The value the setting holds inside the bypass. */
const LIFTED = 'true';

/**
 * DI token for registering a `PrismaTransactionRunner` through Nest directly
 * with the bypass; `prismaPersistence({ rlsIntegration })` passes it itself.
 */
export const PRISMA_RLS_BYPASS_TOKEN = Symbol.for('saasicat/adapter-prisma/PrismaRlsBypass');

/** What the extension needs of a Prisma client: a batch transaction and a raw statement. */
interface BatchingClient {
    $extends(extension: unknown): unknown;
    $transaction(statements: readonly unknown[]): Promise<unknown[]>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): unknown;
}

/** What the runner needs of the transaction it opened. */
export interface RlsTransactionClient {
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
}

interface OperationCall {
    args: unknown;
    query: (args: unknown) => PromiseLike<unknown>;
}

/**
 * The RLS bypass for a Prisma client, in one piece: the port the platform
 * calls, the client whose statements it lifts, and the transactions the
 * platform's runner opens on that client.
 *
 * `prismaPersistence({ rlsIntegration: true })` builds one and wires all
 * three. Build one yourself only to lift your own statements with the same
 * port: `bypass.extend(prisma)` is your client with the platform's bypass.
 */
export class PrismaRlsBypass {
    /** The port the platform calls. `prismaPersistence` binds it as `rlsBypass`. */
    readonly port = new AsyncLocalRlsBypassAdapter();
    private readonly transactions = new AsyncLocalStorage<{ lifted: boolean }>();
    private readonly extended = new WeakMap<object, object>();

    /** @param setting The setting the installation's policies read. */
    constructor(private readonly setting: string = DEFAULT_RLS_BYPASS_SETTING) {}

    /**
     * `client` with every statement run inside the bypass — a model
     * operation or a raw one — lifted. Outside the bypass a statement runs as
     * it is. The same extended client for the same client, however often asked.
     */
    extend<C extends object>(client: C): C {
        const known = this.extended.get(client);
        if (known) return known as C;
        const base = client as unknown as BatchingClient;
        const extension = {
            name: 'saasicat-rls-bypass',
            query: {
                $allOperations: ({ args, query }: OperationCall) => this.run(base, args, query),
            },
        };
        const extended = base.$extends(extension) as C;
        this.extended.set(client, extended);
        return extended;
    }

    /**
     * Runs `work` on a transaction just opened, lifted when it was opened
     * inside the bypass. The platform's runner calls this; a statement of
     * `work` then runs as it is, and the setting ends with the transaction.
     */
    async openedTransaction<T>(tx: RlsTransactionClient, work: () => Promise<T>): Promise<T> {
        const lifted = this.port.isBypassActive();
        return this.transactions.run({ lifted }, async () => {
            if (lifted) await tx.$executeRaw`SELECT set_config(${this.setting}, ${LIFTED}, true)`;
            return work();
        });
    }

    private async run(
        base: BatchingClient,
        args: unknown,
        query: OperationCall['query'],
    ): Promise<unknown> {
        if (!this.port.isBypassActive()) return query(args);
        const transaction = this.transactions.getStore();
        if (transaction?.lifted) return query(args);
        if (transaction) {
            throw new Error(
                'A statement entered the RLS bypass inside a transaction opened outside it. ' +
                    'The setting would outlast the bypass for the rest of that transaction, so ' +
                    'the statement is refused rather than run under the tenant policy. Open the ' +
                    'transaction inside runWithBypass.',
            );
        }
        const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config(${this.setting}, ${LIFTED}, true)`,
            query(args),
        ]);
        return result;
    }
}
