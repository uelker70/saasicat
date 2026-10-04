// Whether a text is a VAT identification number of a member state of the
// European Union.
//
// A prefix alone does not say so: the field holds whatever a subscriber typed,
// and an identifier from outside the Union — a Mexican RFC, say, which begins
// with letters from the company's name — can begin with a member state's code.
// So each prefix is checked with the format that state's numbers have, as the
// European Commission publishes them for VIES. Each pattern is fixed and
// anchored, with no two quantifiers that could share a character, so a long
// input costs one pass.

/** The part after the prefix, by prefix. Greece is `EL`; `GR` is read as the same state. */
const AFTER_PREFIX: ReadonlyMap<string, RegExp> = new Map([
    ['AT', /^U\d{8}$/],
    ['BE', /^[01]\d{9}$/],
    ['BG', /^\d{9,10}$/],
    ['CY', /^\d{8}[A-Z]$/],
    ['CZ', /^\d{8,10}$/],
    ['DE', /^\d{9}$/],
    ['DK', /^\d{8}$/],
    ['EE', /^\d{9}$/],
    ['EL', /^\d{9}$/],
    ['GR', /^\d{9}$/],
    ['ES', /^[0-9A-Z]\d{7}[0-9A-Z]$/],
    ['FI', /^\d{8}$/],
    ['FR', /^[0-9A-Z]{2}\d{9}$/],
    ['HR', /^\d{11}$/],
    ['HU', /^\d{8}$/],
    ['IE', /^\d[0-9A-Z+*]\d{5}[A-Z]{1,2}$/],
    ['IT', /^\d{11}$/],
    ['LT', /^(?:\d{9}|\d{12})$/],
    ['LU', /^\d{8}$/],
    ['LV', /^\d{11}$/],
    ['MT', /^\d{8}$/],
    ['NL', /^\d{9}B\d{2}$/],
    ['PL', /^\d{10}$/],
    ['PT', /^\d{9}$/],
    ['RO', /^\d{2,10}$/],
    ['SE', /^\d{12}$/],
    ['SI', /^\d{8}$/],
    ['SK', /^\d{10}$/],
]);

/**
 * Whether `vatId`, stored as the platform stores it — upper case, without
 * spaces, dots or hyphens — has the prefix and the format of a member state's
 * VAT identification number.
 */
export function isMemberStateVatId(vatId: string): boolean {
    const format = AFTER_PREFIX.get(vatId.slice(0, 2));
    return format !== undefined && format.test(vatId.slice(2));
}
