// Reading a text column whose values the platform keeps to a closed set.
//
// The canonical schema stores several such columns as plain text, so the
// database holds whatever was written to them — by this platform, by an older
// release, or by hand. A mapper checks the value it reads against the set
// instead of casting it: a foreign value then stops at the read and names its
// row, rather than reaching a branch that answers every unknown value as one of
// the known ones.

/** Where a value was read from, for the refusal to name. */
export interface ClosedValueSource {
    table: string;
    column: string;
    id: string;
}

export function oneOf<T extends string>(
    allowed: readonly T[],
    value: string,
    source: ClosedValueSource,
): T {
    const match = allowed.find((entry) => entry === value);
    if (match === undefined) {
        throw new Error(
            `${source.table} row '${source.id}' holds ${source.column} '${value}', ` +
                `which is none of ${allowed.join(', ')}.`,
        );
    }
    return match;
}
