// Which public entry a module inside this package belongs to.
//
// The SFC build rewrites its own deep imports to the package's public
// specifiers, and the declarations emitted beside it have to be rewritten the
// same way. Two copies of that mapping is the duplication jscpd cannot see:
// one decision written twice, drifting the first time a layer moves. So it is
// written here and read by both.
//
// A self-reference rather than a relative path, because the depth differs per
// output file and the export map already answers the question. Every name the
// SFC tree reaches is published by one of these — 360 of 360, measured, which
// is what makes the rewrite total rather than mostly right.

/** Source directory under `src/` → the specifier that publishes it. */
export const PUBLIC_ENTRY_OF_LAYER = {
    client: '@saasicat/ui-vue',
    vue: '@saasicat/ui-vue',
    quasar: '@saasicat/ui-vue/quasar',
};

/**
 * The public specifier for a path relative to `src/`, or `null` when the module
 * is part of the SFC surface and stays a relative import.
 */
export function publicEntryFor(relativeToSrc) {
    const layer = relativeToSrc.split(/[\\/]/)[0];
    return PUBLIC_ENTRY_OF_LAYER[layer] ?? null;
}
