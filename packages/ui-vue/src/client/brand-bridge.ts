/**
 * Writes the consumer's brand into the variables Quasar and the theme read.
 *
 * This is the counterpart to `bindSaThemeToDocument`: that one bridges the
 * colour scheme, this one bridges the palette. Both write to the document, both
 * hand back the undo, and both are the shipped implementation rather than a
 * recipe — so the visual fixture can wire itself the way a consumer's app is
 * wired instead of imitating it. An imitation is what the theme test started
 * out as, and it reported nineteen pages of unreadable text.
 *
 * Only the brand colour lives here. The four status tones are a mapping from
 * one set of variables to another, with no runtime value in it, so they are
 * four lines of CSS in `tokens.semantic.*.css` instead — where they degrade to
 * Quasar's own defaults if the stylesheet is missing, carry no literal for the
 * token audit to count, and can be overridden on either of the theme's
 * selectors. They were here first, and none of those three was true.
 *
 * Framework-free, for the reason `bindSaThemeAttribute` gives one layer up: an
 * app that embeds only the tenant components has a brand too, and
 * `--sa-color-accent` reads `--q-primary` whether or not Quasar is present. The
 * `--q-` prefix is written out rather than taken from Quasar's `setCssVar`,
 * because importing Quasar to spell a prefix is what this layer exists to
 * avoid — and these variables are Quasar's documented public surface, not an
 * internal detail that moves.
 */

/** Quasar's own prefix for the variables its components read. */
const QUASAR_VAR_PREFIX = '--q-';

/**
 * Writes to `documentElement`, never to `<body>`.
 *
 * Quasar's own helper defaults to the body, and this repository has already
 * paid for that once: a role computed on `:root` never sees a value written to
 * the body, so a brand colour arrived on the page and the accent role stayed
 * blue anyway. `:root` is where Quasar publishes its defaults and where
 * `--sa-color-accent: var(--q-primary, …)` is resolved.
 */
function writeVar(root: HTMLElement, name: string, declaration: Declaration): void {
    root.style.setProperty(`${QUASAR_VAR_PREFIX}${name}`, declaration.value, declaration.priority);
}

/**
 * An inline declaration as the document holds it: a value and its priority.
 *
 * The priority is not decoration. A host that wrote `--q-primary: … !important`
 * did so to outrank an author-level rule, and restoring the value alone hands
 * that rule the win — the page is a different colour after our shell leaves
 * than before it arrived, which is the opposite of what disposal promises.
 */
interface Declaration {
    value: string;
    priority: string;
}

/** What the document declares inline for `--q-<name>` right now. */
function readVar(root: HTMLElement, name: string): Declaration {
    const property = `${QUASAR_VAR_PREFIX}${name}`;
    return {
        value: root.style.getPropertyValue(property),
        priority: root.style.getPropertyPriority(property),
    };
}

/** Ours, which never needs to outrank anything. */
const plain = (value: string): Declaration => ({ value, priority: '' });

/** Restores whatever the document declared inline before we wrote to it. */
function restoreInline(root: HTMLElement, previous: Map<string, Declaration>): () => void {
    return () => {
        for (const [name, declaration] of previous) {
            // An empty string is what `getPropertyValue` returns for "the
            // inline style did not set it", and removing is how that is
            // restored — setting it to `''` leaves an empty declaration behind.
            if (declaration.value) writeVar(root, name, declaration);
            else root.style.removeProperty(`${QUASAR_VAR_PREFIX}${name}`);
        }
    };
}

/**
 * Writes the brand colour to `--q-primary`, which is what `--sa-color-accent`
 * reads. One switch: hero, buttons, focus ring, tinted surfaces, Quasar's own
 * components and the tenant-facing pages all follow it.
 *
 * Returns the undo. Without it the value outlives the shell that set it: a
 * second shell created without `brand.color` inherits the first one's branding,
 * and a host that had set `--q-primary` itself never gets it back.
 */
export function applyBrandColour(colour: string | undefined): () => void {
    if (!colour) return () => {};
    if (typeof document === 'undefined') return () => {};

    const root = document.documentElement;
    const previous = new Map([['primary', readVar(root, 'primary')]]);
    writeVar(root, 'primary', plain(colour));
    return restoreInline(root, previous);
}
