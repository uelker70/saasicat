/**
 * The decimal a number was written as, for a `numeric` column.
 *
 * `toFixed` rounds the binary double rather than the decimal somebody typed:
 * `(1.005).toFixed(2)` is `'1.00'` and `(2.675).toFixed(2)` is `'2.67'`, while
 * `(10.005).toFixed(2)` is `'10.01'` — which way a value goes depends on its
 * binary representation, not on a rule anyone chose. The shortest decimal that
 * reads back as the same number is what was written; handed to the column, the
 * database applies its one rounding rule, half away from zero. Where the
 * platform validates an amount to the column's places at its boundary, nothing
 * is rounded at all.
 */
export function toDecimalString(value: number): string {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${String(value)} is not an amount a numeric column can hold.`);
    }
    return String(value);
}
