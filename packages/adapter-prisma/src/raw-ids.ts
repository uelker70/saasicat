/** The ids a raw query selected as `id`. */
export function idsOf(rows: unknown): string[] {
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: unknown) => {
        const id: unknown =
            row !== null && typeof row === 'object'
                ? Object.getOwnPropertyDescriptor(row, 'id')?.value
                : undefined;
        return typeof id === 'string' ? [id] : [];
    });
}
