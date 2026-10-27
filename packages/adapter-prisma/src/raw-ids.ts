/** What a raw query selected as `column` in `row`, unread. */
export function columnOf(row: unknown, column: string): unknown {
    return row !== null && typeof row === 'object'
        ? Object.getOwnPropertyDescriptor(row, column)?.value
        : undefined;
}

/** The texts a raw query selected as `column`. */
export function textsOf(rows: unknown, column: string): string[] {
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: unknown) => {
        const value = columnOf(row, column);
        return typeof value === 'string' ? [value] : [];
    });
}

/** The ids a raw query selected as `id`. */
export function idsOf(rows: unknown): string[] {
    return textsOf(rows, 'id');
}
