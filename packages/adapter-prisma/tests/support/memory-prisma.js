// A Prisma client over arrays, as far as the payment repository uses one: the
// delegates' reads and writes with their `where`, `orderBy` and `take`, a
// `createMany` that skips what a unique key already holds, `$queryRaw`
// recorded and answered by the test, and a transaction that runs on the same
// client.
//
// The unique keys are read from fragment 24 rather than listed here: a write
// the repository expects the database to skip is skipped only because the
// fragment says so, and a key the fragment drops stops holding here as well.
// Whether the writes hold under concurrency is the persistence contract's to
// prove against PostgreSQL; this client never runs two things at once.

import { readFileSync } from 'node:fs';

const FRAGMENT = new URL(
    '../../../spec/prisma-fragments/24-subscriber-payments.prisma',
    import.meta.url,
);

/** The unique keys of each model of the fragment, under its delegate's name. */
function uniqueKeysOf(fragment) {
    const keys = {};
    let delegate = null;
    for (const line of fragment.split('\n').map((each) => each.trim())) {
        if (line.startsWith('model ')) {
            const name = line.split(/\s+/)[1];
            delegate = name.charAt(0).toLowerCase() + name.slice(1);
            keys[delegate] = [];
            continue;
        }
        if (delegate === null) continue;
        if (line === '}') {
            delegate = null;
        } else if (line.startsWith('@@unique([')) {
            const listed = line.slice('@@unique(['.length, line.indexOf(']'));
            keys[delegate].push(listed.split(',').map((column) => column.trim()));
        } else if (!line.startsWith('//') && line.split(/\s+/).includes('@unique')) {
            keys[delegate].push([line.split(/\s+/)[0]]);
        }
    }
    return keys;
}

export const UNIQUE_KEYS = uniqueKeysOf(readFileSync(FRAGMENT, 'utf8'));

const comparable = (value) => (value instanceof Date ? value.getTime() : (value ?? null));
const same = (a, b) => comparable(a) === comparable(b);
const OPERATORS = ['in', 'not', 'gt'];

/** Whether `row` meets `where`, as far as the repository writes conditions. */
function meets(row, where = {}) {
    return Object.entries(where).every(([key, condition]) => {
        if (condition === undefined) return true;
        if (key === 'OR') return condition.some((each) => meets(row, each));
        const isObject =
            condition !== null && typeof condition === 'object' && !(condition instanceof Date);
        if (!isObject) return same(row[key], condition);
        if (!OPERATORS.some((operator) => operator in condition)) {
            // A compound unique key: its columns, each equal.
            return meets(row, condition);
        }
        if ('in' in condition && !condition.in.some((each) => same(row[key], each))) return false;
        if ('not' in condition && same(row[key], condition.not)) return false;
        if ('gt' in condition && !(comparable(row[key]) > comparable(condition.gt))) return false;
        return true;
    });
}

function ordered(rows, orderBy = []) {
    const order = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
        for (const each of order) {
            const [[column, direction]] = Object.entries(each);
            const [x, y] = [comparable(a[column]), comparable(b[column])];
            if (x === y) continue;
            const before = x < y ? -1 : 1;
            return direction === 'desc' ? -before : before;
        }
        return 0;
    });
}

/**
 * A memory client. `tables` seeds the rows under each delegate's name; `raw`
 * answers a raw query from its text and values, and by default answers a
 * `FOR UPDATE` with the row it names.
 */
export function memoryPrisma({ tables = {}, raw } = {}) {
    const rows = Object.fromEntries(
        Object.entries(tables).map(([delegate, seeded]) => [
            delegate,
            seeded.map((r) => ({ ...r })),
        ]),
    );
    const statements = [];
    const rowsOf = (delegate) => (rows[delegate] ??= []);
    const clashes = (delegate, row) =>
        rowsOf(delegate).some(
            (held) =>
                held.id === row.id ||
                (UNIQUE_KEYS[delegate] ?? []).some((key) =>
                    key.every((column) => row[column] != null && same(held[column], row[column])),
                ),
        );
    const insert = (delegate, data, skipDuplicates) => {
        const written = [];
        for (const row of data) {
            if (clashes(delegate, row)) {
                if (skipDuplicates) continue;
                throw new Error(`Unique constraint failed on ${delegate} for ${row.id}`);
            }
            rowsOf(delegate).push({ ...row });
            written.push({ ...row });
        }
        return written;
    };

    const delegate = (name) => {
        const record = (method, args) => statements.push([name, method, args]);
        return {
            async findUnique(args) {
                record('findUnique', args);
                const found = rowsOf(name).find((row) => meets(row, args.where));
                return found ? { ...found } : null;
            },
            async findMany(args = {}) {
                record('findMany', args);
                const found = ordered(
                    rowsOf(name).filter((row) => meets(row, args.where)),
                    args.orderBy,
                );
                return found.slice(0, args.take ?? found.length).map((row) => ({ ...row }));
            },
            async create(args) {
                record('create', args);
                return insert(name, [args.data], false)[0];
            },
            async createMany(args) {
                record('createMany', args);
                return { count: insert(name, args.data, args.skipDuplicates).length };
            },
            async createManyAndReturn(args) {
                record('createManyAndReturn', args);
                return insert(name, args.data, args.skipDuplicates);
            },
            async update(args) {
                record('update', args);
                const found = rowsOf(name).find((row) => meets(row, args.where));
                if (!found)
                    throw new Error(`No ${name} row to update for ${JSON.stringify(args.where)}`);
                Object.assign(found, args.data);
                return { ...found };
            },
            async updateMany(args) {
                record('updateMany', args);
                const found = rowsOf(name).filter((row) => meets(row, args.where));
                for (const row of found) Object.assign(row, args.data);
                return { count: found.length };
            },
        };
    };

    const answerRaw =
        raw ?? ((sql, values) => (sql.includes('FOR UPDATE') ? [{ id: values[0] }] : []));
    const client = new Proxy(
        {
            statements,
            rows: rowsOf,
            async $queryRaw(strings, ...values) {
                const sql = strings.join('?');
                statements.push(['$queryRaw', sql, values]);
                return answerRaw(sql, values);
            },
            async $transaction(work) {
                statements.push(['$transaction']);
                return work(client);
            },
        },
        {
            get(target, property) {
                if (property in target || typeof property !== 'string') return target[property];
                return (target[property] = delegate(property));
            },
        },
    );
    return client;
}

/** The raw statements of `client`, as their text. */
export const rawOf = (client) =>
    client.statements.filter(([kind]) => kind === '$queryRaw').map(([, sql]) => sql);

/** The writes of `client` to the delegate `name`, as `[method, args]`. */
export const writesTo = (client, name) =>
    client.statements
        .filter(([delegate, method]) => delegate === name && !method.startsWith('find'))
        .map(([, method, args]) => [method, args]);
