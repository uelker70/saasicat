/** Admits a piece of work when a place is free; see `concurrencyGate`. */
export type ConcurrencyGate = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * Admits at most `limit` pieces of work at once and queues the rest in the
 * order they arrived.
 *
 * Meant for transactions. Each holds a pooled connection for its whole life,
 * and the platform's transactions take row locks and then read further. Run
 * as many at once as there are requests, and every connection can end up held
 * by a transaction waiting for a lock — or for a connection a sibling needs —
 * while the statements that would let them finish wait for the pool: the
 * service stalls until transactions time out. A limit below the pool size
 * keeps connections free for the work outside a transaction.
 *
 * A place is handed to the next in line when work ends, however it ends, so
 * the count never rises above the limit and nobody waiting is overtaken.
 */
export function concurrencyGate(limit: number): ConcurrencyGate {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError(`A concurrency limit is a whole number of at least 1, not ${limit}.`);
    }
    let active = 0;
    const waiting: Array<() => void> = [];
    const release = (): void => {
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
    };
    return async <T>(work: () => Promise<T>): Promise<T> => {
        if (active < limit) active += 1;
        else await new Promise<void>((admit) => waiting.push(admit));
        try {
            return await work();
        } finally {
            release();
        }
    };
}

const GATES = new WeakMap<object, ConcurrencyGate>();

/**
 * The one gate of a configuration: every caller holding the same `owner`
 * object gets the same queue, with the limit the first of them brought.
 *
 * A bound is a property of the pool, not of whoever builds a runner. Where
 * the client is an injection token, Nest builds a runner once for every module
 * that asks for one, and a gate per runner would admit the limit once per
 * module — as many transactions as there are features, all against one pool.
 * The options object names the configuration: a persistence bundle hands the
 * same one to every runner it builds, and a token provides one.
 */
export function concurrencyGateOf(owner: object, limit: number): ConcurrencyGate {
    const known = GATES.get(owner);
    if (known) return known;
    const gate = concurrencyGate(limit);
    GATES.set(owner, gate);
    return gate;
}
