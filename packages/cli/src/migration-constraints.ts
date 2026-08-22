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

/**
 * The tables a constraints statement addresses.
 *
 * `CREATE ... INDEX ... ON <table>` and `ALTER TABLE <table>` are the two
 * shapes the canonical file uses; anything else is returned as addressing
 * nothing, which keeps it.
 */
export function tablesAddressedBy(statement: string): string[] {
    return [...statement.matchAll(/\bON\s+"?(\w+)"?|\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map(
        (m) => (m[1] ?? m[2])!,
    );
}

/**
 * The constraints that apply to tables this schema actually has.
 *
 * `schema migrate --fragments=03` produces a migration with the plan-version
 * tables and nothing else, and appending the whole file would add an index on
 * `bundle_versions` — which Prisma then fails to apply, against the shadow
 * database, with P1014 naming a table the consumer never asked for. Found by
 * running the command rather than by reasoning about it.
 *
 * Statements addressing no table at all are kept: an unrecognised shape is a
 * reason to be conservative, not to drop a constraint.
 */
export function constraintsFor(constraintsSql: string, tables: readonly string[]): string {
    const known = new Set(tables);
    return constraintsSql
        .split(/\n\s*\n/)
        .filter((block) => {
            const addressed = tablesAddressedBy(block);
            return addressed.length === 0 || addressed.every((table) => known.has(table));
        })
        .join('\n\n')
        .trimEnd();
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
    context: { readonly sqlPath: string; readonly migration?: string | null },
): ConstraintsReport {
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
