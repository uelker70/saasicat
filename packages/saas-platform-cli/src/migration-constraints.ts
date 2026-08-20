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
 * A migration directory as `prisma migrate dev` leaves it: `<timestamp>_<name>`.
 *
 * Prisma sorts by that prefix and applies in order, so "the migration this run
 * created" is the lexicographically greatest one — the same rule Prisma itself
 * uses to decide what to apply next.
 */
export function newestMigration(directories: readonly string[]): string | null {
    const migrations = directories.filter((name) => /^\d{14}_/.test(name)).sort();
    return migrations.length > 0 ? migrations[migrations.length - 1]! : null;
}

/** Whether this SQL already carries a constraints block from a previous run. */
export function hasConstraints(migrationSql: string): boolean {
    return migrationSql.includes(CONSTRAINTS_MARKER);
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
