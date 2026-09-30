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
// is meant for has to run in that transaction, and where a statement runs is
// decided by the client that sends it, not by the code around it. Prisma tells
// an extension which: none, an interactive transaction by its id, or a batch.
//
// - A statement on the client itself runs as a batch of two, the setting and
//   the statement — also when it is sent from inside a transaction's
//   callback, since it then runs on another connection.
// - An interactive transaction opened on the client inside the bypass — by
//   the runner or by a repository for itself — takes the setting when it
//   opens, and its statements run on it as they are. One opened outside the
//   bypass cannot take the setting later without keeping it for the rest of
//   the transaction, after the bypass has ended, so a statement of it that
//   enters the bypass is refused rather than run under the tenant's policy.
// - A batch opened on the client inside the bypass carries the setting at its
//   head, and its statements run in it as they are. A batch opened on another
//   client carries no setting, so a lifted statement in it is refused.

import { AsyncLocalStorage } from 'node:async_hooks';

import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';

/** The setting a policy reads when the shipped bypass is used as it comes. */
export const DEFAULT_RLS_BYPASS_SETTING = 'app.bypass_rls';

/** The value the setting holds inside the bypass. */
const LIFTED = 'true';

/** A client that can send the setting as a raw statement. */
interface RawClient {
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): unknown;
}

/** What the extension needs of a Prisma client: a batch transaction and a raw statement. */
interface BatchingClient extends RawClient {
    $extends(extension: unknown): unknown;
    $transaction(statements: readonly unknown[]): Promise<unknown[]>;
}

type TransactionMethod = (work: unknown, options?: unknown) => Promise<unknown>;

/** Where Prisma says a statement runs. Not in its public types; see `run`. */
interface StatementTransaction {
    kind: 'itx' | 'batch';
    id?: unknown;
}

interface OperationCall {
    args: unknown;
    query: (args: unknown) => PromiseLike<unknown>;
    __internalParams?: { transaction?: StatementTransaction };
}

const REFUSED_INSIDE_A_TRANSACTION =
    'A statement entered the RLS bypass inside a transaction opened outside it. The setting ' +
    'would outlast the bypass for the rest of that transaction, so the statement is refused ' +
    'rather than run under the tenant policy. Open the transaction inside runWithBypass.';

const BATCH_NOT_LIFTED =
    'A lifted statement entered the RLS bypass in a batch opened on another client, which ' +
    'carries no setting, so the statement is refused rather than run under the tenant policy. ' +
    'Open the batch with $transaction on the lifted client.';

const TRANSACTION_NOT_TOLD =
    'This Prisma client does not tell a query extension which transaction a statement runs ' +
    'in, which PrismaRlsBypass needs to lift a row policy. Bind an RlsBypassPort of your own ' +
    'instead.';

/**
 * The RLS bypass for a Prisma client, in one piece: the port the platform
 * calls, and the client whose statements and transactions it lifts.
 *
 * `prismaPersistence({ rlsIntegration: true })` builds one and wires both.
 * Build one yourself only to lift your own statements with the same port:
 * `bypass.extend(prisma)` is your client with the platform's bypass.
 */
export class PrismaRlsBypass {
    /** The port the platform calls. `prismaPersistence` binds it as `rlsBypass`. */
    readonly port = new AsyncLocalRlsBypassAdapter();
    /** The interactive transactions that took the setting, by the id Prisma gives them. */
    private readonly liftedTransactions = new Set<unknown>();
    /** Set while the setting of a transaction just opened is sent, to learn its id. */
    private readonly opening = new AsyncLocalStorage<{ id?: unknown }>();
    /** Set while a batch that carries the setting at its head runs. */
    private readonly liftedBatch = new AsyncLocalStorage<true>();
    private readonly extended = new WeakMap<object, object>();

    /** @param setting The setting the installation's policies read. */
    constructor(private readonly setting: string = DEFAULT_RLS_BYPASS_SETTING) {}

    /**
     * `client` with every statement run inside the bypass — a model
     * operation or a raw one, on the client, in an interactive transaction or
     * in a batch — lifted. Outside the bypass everything runs as it is. The
     * same client for the same client, however often asked.
     */
    extend<C extends object>(client: C): C {
        const known = this.extended.get(client);
        if (known) return known as C;
        const base = client as unknown as BatchingClient;
        const extension = {
            name: 'saasicat-rls-bypass',
            query: {
                $allOperations: (call: OperationCall) => this.run(base, call),
            },
        };
        const extended = base.$extends(extension) as object;
        // An extension sees each statement but not the transaction being
        // opened, so `$transaction` is taken here, on the one client every
        // adapter shares.
        const lifted = new Proxy(extended, {
            get: (target, property) => {
                const value: unknown = Reflect.get(target, property, target);
                if (property !== '$transaction' || typeof value !== 'function') return value;
                const open = value as TransactionMethod;
                return (work: unknown, options?: unknown) =>
                    this.opened(base, (next) => open.call(target, next, options), work);
            },
        }) as C;
        this.extended.set(client, lifted);
        return lifted;
    }

    /**
     * Opens a transaction through `open`, lifted where the bypass is active:
     * an interactive one takes the setting first, a batch carries it at its
     * head.
     */
    private async opened(
        base: BatchingClient,
        open: (work: unknown) => Promise<unknown>,
        work: unknown,
    ): Promise<unknown> {
        if (!this.port.isBypassActive()) return open(work);
        if (Array.isArray(work)) {
            // Prisma sends a batch's statements from the call that opens it, so
            // the store reaches them and nothing else.
            const results = (await this.liftedBatch.run(true, () =>
                open([this.settingOn(base), ...work]),
            )) as unknown[];
            return results.slice(1);
        }
        const interactive = work as (tx: RawClient) => Promise<unknown>;
        return open(async (tx: RawClient) => {
            const learned: { id?: unknown } = {};
            // Awaited inside: the statement is lazy and runs where it is awaited.
            await this.opening.run(learned, async () => await this.settingOn(tx));
            if (learned.id === undefined) throw new Error(TRANSACTION_NOT_TOLD);
            this.liftedTransactions.add(learned.id);
            try {
                return await interactive(tx);
            } finally {
                this.liftedTransactions.delete(learned.id);
            }
        });
    }

    private settingOn(client: RawClient): PromiseLike<unknown> {
        return client.$executeRaw`SELECT set_config(${this.setting}, ${LIFTED}, true)` as PromiseLike<unknown>;
    }

    private async run(base: BatchingClient, call: OperationCall): Promise<unknown> {
        const { args, query } = call;
        const learning = this.opening.getStore();
        if (learning) {
            learning.id = call.__internalParams?.transaction?.id;
            return query(args);
        }
        if (!this.port.isBypassActive()) return query(args);
        // Prisma hands every query extension `__internalParams`, and in it the
        // transaction a statement runs in. Without it the client cannot be
        // told apart from a transaction, and guessing would break one or the
        // other, so a client that does not say is refused.
        if (!call.__internalParams) throw new Error(TRANSACTION_NOT_TOLD);
        const transaction = call.__internalParams.transaction;
        if (transaction?.kind === 'batch') {
            if (this.liftedBatch.getStore()) return query(args);
            throw new Error(BATCH_NOT_LIFTED);
        }
        if (transaction?.kind === 'itx') {
            if (this.liftedTransactions.has(transaction.id)) return query(args);
            throw new Error(REFUSED_INSIDE_A_TRANSACTION);
        }
        const [, result] = await base.$transaction([this.settingOn(base), query(args)]);
        return result;
    }
}
