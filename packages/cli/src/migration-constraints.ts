// The constraints Prisma's DSL cannot express, and where they go.
//
// `@saasicat/spec/sql/constraints.postgres.sql` holds partial unique indexes
// and a CHECK that are part of the canonical schema, not optional hardening:
// the adapter contract tests run against a database that has them. Until now
// the quickstart asked the integrator to paste the file into the migration
// Prisma had just generated — a manual step in an otherwise automated command,
// and one that is easy to do once and forget on the next upgrade.
//
// Pure functions, so the decision about WHICH migration and WHETHER it already
// has them can be tested without a database or a Prisma CLI.

/** Marks the block this tool appends, and lets it recognise its own work. */
export const CONSTRAINTS_MARKER = '-- saasicat:constraints';

/**
 * The migration THIS run created — the one that is in `after` and not `before`.
 *
 * The first version asked which directory sorts last, which is the same answer
 * whenever the run created one and a silently wrong one when it did not: the
 * step would then edit a stranger's migration, one already applied, and break
 * its checksum. Taking the difference cannot confuse the two.
 *
 * `<timestamp>_<name>` is required, so `migration_lock.toml` and a stray
 * scratch directory are not candidates however they sort.
 */
export function migrationCreatedBy(
    before: readonly string[],
    after: readonly string[],
): string | null {
    const existing = new Set(before);
    const created = after.filter((name) => /^\d{14}_/.test(name) && !existing.has(name)).sort();
    return created.length > 0 ? created[created.length - 1]! : null;
}

/** Whether this SQL already carries a constraints block from a previous run. */
export function hasConstraints(migrationSql: string): boolean {
    return migrationSql.includes(CONSTRAINTS_MARKER);
}

/** What a statement of the constraints file does, read from its first words. */
export type StatementShape =
    /** `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] [<name>] ON [ONLY] <table>` */
    | 'create-index'
    /** `ALTER TABLE [IF EXISTS] [ONLY] <table> …` */
    | 'alter-table'
    /** `ALTER SEQUENCE …` and `SELECT setval(…)`: no table has to exist for them. */
    | 'addresses-no-table'
    /** Any other statement. It names no table this reader could check, so it is kept. */
    | 'unreadable';

export interface ConstraintStatement {
    readonly shape: StatementShape;
    /** The table a `create-index` or `alter-table` statement addresses. */
    readonly table?: string;
    /** The index, or the constraint an `ALTER TABLE` adds or drops. */
    readonly constraint?: string;
    /** The statement as read: comments removed, without its separator. */
    readonly text: string;
}

/**
 * The statements of some SQL, comments removed, cut at each `;` that is code.
 *
 * A hand-written scanner rather than a pattern: a `;` or a `--` inside a
 * string or a quoted name is part of it, and a word in a comment is not code.
 * It knows single-quoted strings, double-quoted names, `--` and non-nested
 * block comments — enough for the shapes below. What it misreads, such as a
 * dollar-quoted body, comes out as a statement of no shape it knows, which is
 * kept.
 */
function statementTexts(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let i = 0;
    while (i < sql.length) {
        const char = sql[i]!;
        if (char === "'" || char === '"') {
            const close = sql.indexOf(char, i + 1);
            const end = close === -1 ? sql.length : close + 1;
            current += sql.slice(i, end);
            i = end;
        } else if (sql.startsWith('--', i)) {
            const newline = sql.indexOf('\n', i);
            i = newline === -1 ? sql.length : newline;
        } else if (sql.startsWith('/*', i)) {
            const close = sql.indexOf('*/', i + 2);
            current += ' ';
            i = close === -1 ? sql.length : close + 2;
        } else if (char === ';') {
            statements.push(current);
            current = '';
            i += 1;
        } else {
            current += char;
            i += 1;
        }
    }
    statements.push(current);
    return statements.map((text) => text.trim()).filter((text) => text !== '');
}

/** A word, a quoted name with its quotes, a string with its quotes, or one other character. */
function tokensOf(text: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < text.length) {
        const char = text[i]!;
        if (/\s/.test(char)) {
            i += 1;
        } else if (char === "'" || char === '"') {
            // A doubled quote inside comes out as two adjacent tokens of the
            // same kind, which no shape below mistakes for a keyword.
            const close = text.indexOf(char, i + 1);
            const end = close === -1 ? text.length : close + 1;
            tokens.push(text.slice(i, end));
            i = end;
        } else if (/\w/.test(char)) {
            let end = i + 1;
            while (end < text.length && /[\w$]/.test(text[end]!)) end += 1;
            tokens.push(text.slice(i, end));
            i = end;
        } else {
            tokens.push(char);
            i += 1;
        }
    }
    return tokens;
}

/** A name as the schema spells it: quotes taken off, a schema qualifier dropped. */
function nameAt(tokens: readonly string[], at: number): { name: string; next: number } | null {
    let i = at;
    for (;;) {
        const token = tokens[i];
        if (token === undefined || !/^["\w]/.test(token)) return null;
        const name = token.startsWith('"') ? token.slice(1, -1) : token;
        if (tokens[i + 1] !== '.') return { name, next: i + 1 };
        i += 2;
    }
}

/** Whether the tokens at `at` are these keywords, case aside. */
function keywordsAt(tokens: readonly string[], at: number, ...words: string[]): boolean {
    return words.every((word, k) => tokens[at + k]?.toUpperCase() === word);
}

function readCreateIndex(tokens: readonly string[], text: string): ConstraintStatement | null {
    let i = 1;
    if (keywordsAt(tokens, i, 'UNIQUE')) i += 1;
    if (!keywordsAt(tokens, i, 'INDEX')) return null;
    i += 1;
    if (keywordsAt(tokens, i, 'CONCURRENTLY')) i += 1;
    if (keywordsAt(tokens, i, 'IF', 'NOT', 'EXISTS')) i += 3;
    let constraint: string | undefined;
    if (!keywordsAt(tokens, i, 'ON')) {
        const index = nameAt(tokens, i);
        if (!index) return null;
        constraint = index.name;
        i = index.next;
    }
    if (!keywordsAt(tokens, i, 'ON')) return null;
    i += 1;
    if (keywordsAt(tokens, i, 'ONLY')) i += 1;
    const table = nameAt(tokens, i);
    if (!table) return null;
    return { shape: 'create-index', table: table.name, constraint, text };
}

function readAlterTable(tokens: readonly string[], text: string): ConstraintStatement | null {
    let i = 2;
    if (keywordsAt(tokens, i, 'IF', 'EXISTS')) i += 2;
    if (keywordsAt(tokens, i, 'ONLY')) i += 1;
    const table = nameAt(tokens, i);
    if (!table) return null;
    let constraint: string | undefined;
    for (let k = table.next; k < tokens.length && constraint === undefined; k += 1) {
        if (!keywordsAt(tokens, k, 'CONSTRAINT')) continue;
        const preceding = tokens[k - 1]?.toUpperCase();
        if (preceding !== 'ADD' && preceding !== 'DROP') continue;
        const at = keywordsAt(tokens, k + 1, 'IF', 'EXISTS') ? k + 3 : k + 1;
        constraint = nameAt(tokens, at)?.name;
    }
    return { shape: 'alter-table', table: table.name, constraint, text };
}

function readStatement(text: string): ConstraintStatement {
    const tokens = tokensOf(text);
    const read = keywordsAt(tokens, 0, 'CREATE')
        ? readCreateIndex(tokens, text)
        : keywordsAt(tokens, 0, 'ALTER', 'TABLE')
          ? readAlterTable(tokens, text)
          : null;
    if (read) return read;
    if (keywordsAt(tokens, 0, 'ALTER', 'SEQUENCE') || keywordsAt(tokens, 0, 'SELECT', 'SETVAL')) {
        return { shape: 'addresses-no-table', text };
    }
    return { shape: 'unreadable', text };
}

/** Every statement of some SQL, each with what it addresses. */
export function readStatements(sql: string): ConstraintStatement[] {
    return statementTexts(sql).map(readStatement);
}

/**
 * The tables the statements of some SQL address, in order, comments aside.
 *
 * Read from the shape of each statement — the table after `ON` of a
 * `CREATE INDEX`, after `ALTER TABLE` — and never from a word elsewhere, which
 * may be a comment's "on purpose" or a `CHECK`'s `IN ('on')`.
 */
export function tablesAddressedBy(sql: string): string[] {
    return readStatements(sql).flatMap((statement) => statement.table ?? []);
}

/** A block of the constraints file that this schema cannot take. */
export interface LeftOutConstraint {
    /** The indexes and constraints the block declares, so the operator can find it. */
    readonly constraints: readonly string[];
    /** The tables it addresses that the schema does not have. */
    readonly missingTables: readonly string[];
}

export interface ConstraintsSelection {
    /** The blocks to append, as the file writes them, comments included. */
    readonly applicable: string;
    /** Each block left out, in the order of the file. */
    readonly leftOut: readonly LeftOutConstraint[];
}

/**
 * The constraints that apply to tables this schema actually has, and the ones
 * that do not.
 *
 * `schema migrate --fragments=03` produces a migration with the plan-version
 * tables and nothing else, and appending the whole file would add an index on
 * `bundle_versions` — which Prisma then fails to apply, against the shadow
 * database, with P1014 naming a table the consumer never asked for.
 *
 * The file is cut into blocks at blank lines, because a block is what belongs
 * together: the `DROP` that makes an `ADD CONSTRAINT` repeatable goes with it.
 * A block is kept when every table its statements address is in the schema.
 * Statements addressing no table are kept: an unrecognised shape is a reason to
 * be conservative, not to drop a constraint.
 */
export function selectConstraints(
    constraintsSql: string,
    tables: readonly string[],
): ConstraintsSelection {
    const known = new Set(tables);
    const kept: string[] = [];
    const leftOut: LeftOutConstraint[] = [];
    for (const block of blocksOf(constraintsSql)) {
        const statements = readStatements(block);
        const missingTables = unique(
            statements.flatMap((statement) => statement.table ?? []).filter((t) => !known.has(t)),
        );
        if (missingTables.length === 0) {
            kept.push(block);
            continue;
        }
        const constraints = unique(statements.flatMap((statement) => statement.constraint ?? []));
        leftOut.push({ constraints, missingTables });
    }
    return { applicable: kept.join('\n\n').trimEnd(), leftOut };
}

/** The blank-line separated blocks of some SQL, each without its surrounding blank lines. */
function blocksOf(sql: string): string[] {
    const blocks: string[] = [];
    let lines: string[] = [];
    for (const line of sql.split('\n')) {
        if (line.trim() !== '') {
            lines.push(line);
            continue;
        }
        if (lines.length > 0) blocks.push(lines.join('\n'));
        lines = [];
    }
    if (lines.length > 0) blocks.push(lines.join('\n'));
    return blocks;
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

/** One line per left-out block, as `schema migrate` prints it. */
function describeLeftOut(entry: LeftOutConstraint): string {
    const what = entry.constraints.length > 0 ? entry.constraints.join(', ') : 'a statement';
    const tables = entry.missingTables.length === 1 ? 'table' : 'tables';
    return `  - left out ${what}: this schema has no ${tables} ${entry.missingTables.join(', ')}`;
}

/**
 * The migration with the constraints appended, or the input unchanged when it
 * already has them.
 *
 * Appended rather than merged: the statements are `CREATE UNIQUE INDEX IF NOT
 * EXISTS` and an `ALTER TABLE ... ADD CONSTRAINT`, so they have to run after
 * the tables exist, and Prisma writes the table creation into the same file.
 */
export function appendConstraints(migrationSql: string, constraintsSql: string): string {
    if (hasConstraints(migrationSql)) return migrationSql;
    if (constraintsSql.trim() === '') return migrationSql;
    const body = migrationSql.endsWith('\n') ? migrationSql : `${migrationSql}\n`;
    return (
        `${body}\n` +
        `${CONSTRAINTS_MARKER} — appended by \`saasicat schema migrate\`.\n` +
        '-- Source: @saasicat/spec/sql/constraints.postgres.sql. These are part of the\n' +
        '-- canonical schema: the adapter contract tests run against a database that has\n' +
        '-- them. Edit the spec, not this copy.\n' +
        `${constraintsSql.trimEnd()}\n`
    );
}

/**
 * What step 3 of `schema migrate` did — and whether step 4 may follow.
 *
 * It was a boolean, and the boolean conflated two states that need opposite
 * answers: "there was nothing to append" and "appending failed". On the second
 * one the command told the operator to add the SQL by hand *before applying
 * it* — and then applied it three lines later, which both makes the advice
 * unfollowable and puts the file under a recorded checksum, so editing it
 * afterwards offers a reset. Prisma's `--create-only` exists to open exactly
 * that window; closing it by hand was the point.
 */
export type ConstraintsOutcome =
    /** Written into the migration this run created. */
    | 'appended'
    /** The migration already carried them — a re-run. */
    | 'already-present'
    /** No constraint addresses a table in this schema. */
    | 'not-applicable'
    /** Prisma created no migration, so there was nothing to append to. */
    | 'no-migration'
    /** The file could not be read or written. */
    | 'failed';

export interface ConstraintsReport {
    readonly outcome: ConstraintsOutcome;
    /**
     * Whether the command may go on to apply the migration.
     *
     * False only for `failed`: every other outcome leaves a migration that is
     * complete, or none at all.
     */
    readonly mayApply: boolean;
    /** What to tell the operator, in one line. */
    readonly message: string;
    /**
     * One line for each block of the file the schema could not take, so that
     * saying nothing more means every constraint went in.
     */
    readonly leftOut: readonly string[];
}

/**
 * The decision and the message together, so they cannot contradict each other.
 *
 * They did: the message named a window the caller had already closed. Keeping
 * them in one function lets a test assert the invariant that broke —
 * "before applying" appears exactly when the command will not apply.
 */
export function reportConstraints(
    outcome: ConstraintsOutcome,
    context: {
        readonly sqlPath: string;
        readonly migration?: string | null;
        readonly leftOut?: readonly LeftOutConstraint[];
    },
): ConstraintsReport {
    return {
        ...decideConstraints(outcome, context),
        leftOut: (context.leftOut ?? []).map(describeLeftOut),
    };
}

function decideConstraints(
    outcome: ConstraintsOutcome,
    context: { readonly sqlPath: string; readonly migration?: string | null },
): Omit<ConstraintsReport, 'leftOut'> {
    switch (outcome) {
        case 'appended':
            return {
                outcome,
                mayApply: true,
                message: `  + appended to ${context.migration}/migration.sql`,
            };
        case 'already-present':
            return {
                outcome,
                mayApply: true,
                message: `  = ${context.migration} already carries them.`,
            };
        case 'not-applicable':
            return {
                outcome,
                mayApply: true,
                message: '  = none of them apply to the tables in this schema.',
            };
        case 'no-migration':
            return {
                outcome,
                mayApply: true,
                message:
                    '  = Prisma created no migration — nothing to append to, and nothing new ' +
                    'to apply.',
            };
        case 'failed':
            return {
                outcome,
                mayApply: false,
                message:
                    `  ! Could not append them, so the migration is incomplete. Add ` +
                    `${context.sqlPath} to it by hand, before applying it — nothing was applied.`,
            };
    }
}
