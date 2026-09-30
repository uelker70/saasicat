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
// then the statement. An interactive transaction opened on the client takes
// the setting when it opens inside the bypass — the runner's and one a
// repository opens for itself alike — and its statements then run as they
// are, on it. A transaction opened outside the bypass cannot take the setting
// later without keeping it for the rest of the transaction, after the bypass
// has ended, so a statement that enters the bypass inside one is refused
// rather than run under a policy that hides what it looks for.

import { AsyncLocalStorage } from 'node:async_hooks';

import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';

/** The setting a policy reads when the shipped bypass is used as it comes. */
export const DEFAULT_RLS_BYPASS_SETTING = 'app.bypass_rls';

/** The value the setting holds inside the bypass. */
const LIFTED = 'true';

/** What the extension needs of a Prisma client: a batch transaction and a raw statement. */
interface BatchingClient {
    $extends(extension: unknown): unknown;
    $transaction(statements: readonly unknown[]): Promise<unknown[]>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): unknown;
}

/** What the setting needs of a transaction just opened. */
interface TransactionClient {
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
}

type InteractiveTransaction = (
    work: (tx: TransactionClient) => Promise<unknown>,
    options?: unknown,
) => Promise<unknown>;

interface OperationCall {
    args: unknown;
    query: (args: unknown) => PromiseLike<unknown>;
}

/**
 * The RLS bypass for a Prisma client, in one piece: the port the platform
 * calls, and the client whose statements and transactions it lifts.
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
     * operation or a raw one — lifted, and every interactive transaction
     * opened on it inside the bypass lifted for its whole length. Outside the
     * bypass both run as they are. The same client for the same client,
     * however often asked.
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
        const extended = base.$extends(extension) as object;
        // An extension sees each statement but not the transaction it belongs
        // to, so the interactive form of `$transaction` is taken here, on the
        // one client every adapter shares. The batch form passes as it is.
        const lifted = new Proxy(extended, {
            get: (target, property) => {
                const value: unknown = Reflect.get(target, property, target);
                if (property !== '$transaction' || typeof value !== 'function') return value;
                const open = value as InteractiveTransaction;
                return (work: unknown, options?: unknown) =>
                    typeof work === 'function'
                        ? open.call(
                              target,
                              (tx) =>
                                  this.opened(tx, () =>
                                      (work as InteractiveTransaction)(tx as never),
                                  ),
                              options,
                          )
                        : (value as (work: unknown, options?: unknown) => unknown).call(
                              target,
                              work,
                              options,
                          );
            },
        }) as C;
        this.extended.set(client, lifted);
        return lifted;
    }

    /** Runs `work` on a transaction just opened, lifted when it was opened inside the bypass. */
    private async opened<T>(tx: TransactionClient, work: () => Promise<T>): Promise<T> {
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
