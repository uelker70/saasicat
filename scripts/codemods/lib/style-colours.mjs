// Finding colour literals in the places a stylesheet actually paints.
//
// The migration and the inventory that drives it MUST agree about what counts
// as a colour and what role it plays, or the reviewed mapping describes one set
// of sites and the rewrite touches another. So both read this module, and there
// is no second parser.
//
// Two rules shape everything here:
//
//   1. Only `<style>` blocks and `.css` files. Never a template, never TypeScript
//      — `#fff` in a template is a data value, and `background` in a `:style`
//      binding is a decision the codemod is not allowed to make.
//   2. A colour's role comes from the PROPERTY it is assigned to, not from the
//      value. `#fff` is a surface in `background: #fff` and a foreground in
//      `color: #fff`; a single hex-to-token map would collapse the two and
//      repaint half the admin white-on-white.

/** Hex (3/4/6/8 digits) and the functional notations with literal channels. */
const COLOUR_PATTERN = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;

/**
 * Which paint job a declaration is doing.
 *
 * `custom` is its own group because a custom property's role is decided by its
 * readers, not by its own name — those sites are reviewed individually rather
 * than mapped by rule.
 */
const PROPERTY_GROUPS = [
    [/^--/, 'custom'],
    [/^(?:color|-webkit-text-fill-color|caret-color)$/, 'text'],
    [/^(?:background|background-color|background-image)$/, 'surface'],
    [/^(?:border|border-[a-z-]*|outline|outline-color)$/, 'border'],
    [/^(?:box-shadow|text-shadow|filter|backdrop-filter)$/, 'shadow'],
    [/^(?:fill|stroke)$/, 'icon'],
];

/** @returns {'custom'|'text'|'surface'|'border'|'shadow'|'icon'|'other'} */
export function propertyGroup(property) {
    const name = property.trim().toLowerCase();
    for (const [pattern, group] of PROPERTY_GROUPS) if (pattern.test(name)) return group;
    return 'other';
}

/**
 * The stylesheet parts of a file, with their offset in the original text.
 *
 * `.css` is one block starting at 0; an SFC contributes one block per `<style>`
 * element. The offset matters: every site this module reports is patched by
 * index later, and an index into the block would land in the template.
 */
export function styleBlocks(file, content) {
    if (file.endsWith('.css')) return [{ text: content, offset: 0 }];
    const blocks = [];
    const pattern = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
        blocks.push({ text: match[1], offset: match.index + match[0].indexOf(match[1]) });
    }
    return blocks;
}

/**
 * Declarations in a stylesheet, as `property` plus the exact span of the value.
 *
 * Hand-written rather than delegated to a CSS parser because the input is
 * whole `.vue` files and the output has to be a byte range in the ORIGINAL
 * text: a parser that reprints the stylesheet would reformat 70 files in the
 * same commit that migrates their colours, and the diff would be unreviewable.
 *
 * Nested blocks (`@media`, `:deep()`) need no special handling — a declaration
 * is whatever sits between two block delimiters, at any depth.
 */
export function declarations(text) {
    const found = [];
    let chunkStart = 0;
    let parens = 0;
    let quote = null;

    const flush = (end) => {
        const chunk = text.slice(chunkStart, end);
        const colon = colonAt(chunk);
        if (colon !== -1) {
            const property = chunk.slice(0, colon).trim();
            // A selector can carry a colon too (`a:hover`, `::before`). A
            // declaration's property never contains whitespace or a brace.
            if (property && !/[\s{}]/.test(property)) {
                const valueStart = chunkStart + colon + 1;
                found.push({
                    property,
                    value: text.slice(valueStart, end),
                    valueStart,
                    valueEnd: end,
                });
            }
        }
        chunkStart = end + 1;
    };

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === quote && text[i - 1] !== '\\') quote = null;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? text.length : end + 1;
            continue;
        }
        if (char === '(') parens += 1;
        else if (char === ')') parens = Math.max(0, parens - 1);
        else if (parens === 0 && (char === ';' || char === '}')) flush(i);
        else if (parens === 0 && char === '{') chunkStart = i + 1;
    }
    return found;
}

/** First `:` outside parentheses — `var(--x, a:b)` must not split the property. */
function colonAt(chunk) {
    let parens = 0;
    for (let i = 0; i < chunk.length; i += 1) {
        if (chunk[i] === '(') parens += 1;
        else if (chunk[i] === ')') parens -= 1;
        else if (chunk[i] === ':' && parens === 0) return i;
    }
    return -1;
}

/** Canonical form for map keys: lowercase, no whitespace inside `rgba(…)`. */
export function normaliseColour(literal) {
    return literal.toLowerCase().replace(/\s+/g, '');
}

/**
 * Every colour literal in a file, with the property that paints it.
 *
 * @returns {{property: string, group: string, value: string, raw: string,
 *            start: number, end: number, line: number}[]} sorted by position
 */
export function colourSites(file, content) {
    const sites = [];
    for (const block of styleBlocks(file, content)) {
        for (const declaration of declarations(block.text)) {
            const group = propertyGroup(declaration.property);
            for (const match of declaration.value.matchAll(COLOUR_PATTERN)) {
                const start = block.offset + declaration.valueStart + match.index;
                sites.push({
                    property: declaration.property,
                    group,
                    value: normaliseColour(match[0]),
                    raw: match[0],
                    start,
                    end: start + match[0].length,
                    line: content.slice(0, start).split('\n').length,
                });
            }
        }
    }
    return sites.sort((a, b) => a.start - b.start);
}

/** Map key for the reviewed mapping: the pair that decides the token. */
export function siteKey(site) {
    return `${site.group} ${site.value}`;
}
