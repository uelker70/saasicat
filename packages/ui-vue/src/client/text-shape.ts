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
 * a dot somewhere after the `@`, and no whitespace anywhere — whitespace as
 * `\s` defines it, Unicode spaces included. The same acceptance the old
 * pattern had, stated in words a reader can check.
 */
export function looksLikeEmail(value: string): boolean {
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return false;
    const domain = value.slice(at + 1);
    const dot = domain.indexOf('.');
    if (dot <= 0 || dot === domain.length - 1) return false;
    for (let i = 0; i < value.length; i += 1) {
        if (isWhitespace(value[i])) return false;
    }
    return true;
}

/**
 * What `\s` means: the ECMAScript WhiteSpace and LineTerminator sets, so a
 * pasted non-breaking or ideographic space is refused the way the old
 * pattern refused it. One character, one comparison each — still linear.
 */
function isWhitespace(ch: string): boolean {
    return (
        ch === ' ' ||
        ch === '\t' ||
        ch === '\n' ||
        ch === '\r' ||
        ch === '\v' ||
        ch === '\f' ||
        ch === '\u00a0' ||
        ch === '\u1680' ||
        (ch >= '\u2000' && ch <= '\u200a') ||
        ch === '\u2028' ||
        ch === '\u2029' ||
        ch === '\u202f' ||
        ch === '\u205f' ||
        ch === '\u3000' ||
        ch === '\ufeff'
    );
}

/** `value` without any run of `ch` at either end — `trim()` for one character. */
export function trimChar(value: string, ch: string): string {
    let start = 0;
    let end = value.length;
    while (start < end && value[start] === ch) start += 1;
    while (end > start && value[end - 1] === ch) end -= 1;
    return value.slice(start, end);
}
