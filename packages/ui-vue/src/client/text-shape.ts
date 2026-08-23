// Shape checks on text someone else typed — without a regular expression
// whose quantifiers can share the input.
//
// `/\S+@\S+\.\S+/` and `/^-+|-+$/` are the two patterns that stood at five
// places in this package. Both backtrack: on a string of ten thousand `@`
// the first one tries every split of `\S+@\S+` before giving up, and the
// input is whatever a user pasted into a field. Scanners over one index
// cannot do that, and they say what they accept.
//
// Shipped as source (see `client/`), so nothing past ES2021 here.

/**
 * Whether `value` looks like an address: one `@`, something on either side,
 * a dot somewhere after the `@`, and no whitespace anywhere. The same
 * acceptance the old pattern had, stated in words a reader can check.
 */
export function looksLikeEmail(value: string): boolean {
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return false;
    const domain = value.slice(at + 1);
    const dot = domain.indexOf('.');
    if (dot <= 0 || dot === domain.length - 1) return false;
    for (let i = 0; i < value.length; i += 1) {
        const ch = value[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return false;
    }
    return true;
}

/** `value` without any run of `ch` at either end — `trim()` for one character. */
export function trimChar(value: string, ch: string): string {
    let start = 0;
    let end = value.length;
    while (start < end && value[start] === ch) start += 1;
    while (end > start && value[end - 1] === ch) end -= 1;
    return value.slice(start, end);
}
