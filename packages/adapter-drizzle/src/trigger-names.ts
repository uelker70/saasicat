/**
 * The `name` column of the rows a raw query over `pg_trigger` answered, whichever
 * driver ran it: postgres.js answers the rows themselves, node-postgres a result
 * that holds them. A shape that is neither is thrown rather than read as no
 * triggers, which an archive would report as unprotected for the wrong reason.
 */
export function triggerNamesOf(result: unknown): string[] {
    const rows = rowsIn(result);
    return rows.map((row: unknown) => {
        if (typeof row !== 'object' || row === null || !('name' in row)) {
            throw new Error('A row of pg_trigger carries no name.');
        }
        return String(row.name);
    });
}

function rowsIn(result: unknown): readonly unknown[] {
    if (Array.isArray(result)) return result;
    if (typeof result === 'object' && result !== null && 'rows' in result) {
        const { rows } = result;
        if (Array.isArray(rows)) return rows;
    }
    throw new Error('A query of pg_trigger answered no rows.');
}
