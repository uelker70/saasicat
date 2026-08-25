/**
 * Splits a message template into parts so a date can be set in bold.
 *
 * The alternative was `v-html`, which means building markup out of translated
 * text and handing it to a renderer — a template a consumer supplies is exactly
 * the string that must never become HTML. This returns data instead: the
 * template around the values, and the values themselves, each marked for
 * emphasis or not.
 *
 * An unknown placeholder stays as it was written. A message that names a value
 * this caller does not have is a translation bug, and showing `{date}` on the
 * screen says so; silently swallowing it produces a sentence with a hole.
 */
export interface MessagePart {
    text: string;
    strong: boolean;
}

export function messageParts(
    template: string,
    values: Record<string, string>,
    emphasise: readonly string[] = ['date', 'deadline'],
): MessagePart[] {
    const parts: MessagePart[] = [];
    let rest = template;

    for (;;) {
        const open = rest.indexOf('{');
        if (open === -1) break;
        const close = rest.indexOf('}', open);
        if (close === -1) break;

        const key = rest.slice(open + 1, close);
        const known = Object.prototype.hasOwnProperty.call(values, key);
        parts.push({ text: rest.slice(0, open), strong: false });
        parts.push(
            known
                ? { text: values[key] ?? '', strong: emphasise.includes(key) }
                : { text: `{${key}}`, strong: false },
        );
        rest = rest.slice(close + 1);
    }

    parts.push({ text: rest, strong: false });
    return parts.filter((part) => part.text !== '');
}
