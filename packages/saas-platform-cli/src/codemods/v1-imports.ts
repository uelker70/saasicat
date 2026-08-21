// Rewrites `@saasicat/ui-vue` imports to the 1.0 export map.
//
// Phase 4 cut the UI surface in three ways, and a consumer meets all three at
// once: `./components/*` is gone, `./pages-standard/*` is gone, and three files
// left `./pages/` for `./layouts/` and `./auth/`.
//
// The mapping is not written here. It is read from `v1-imports.map.json` — the
// table the move itself ran on — so this cannot disagree with what happened to
// the files. Pure functions: the caller does the reading and writing, which is
// what makes the rules testable without a filesystem.

/** One entry of the move table: where a file was, and where it went. */
export interface MoveTable {
    readonly moves: Readonly<Record<string, string>>;
}

/** Subpaths that stay on the public surface after the move. */
const PUBLIC_PREFIXES = ['ui/', 'layouts/', 'auth/', 'pages/'] as const;

/**
 * Old subpath → new subpath, derived from the move table.
 *
 * Both spellings of a page that moved are mapped, because both were reachable:
 * `pages/AdminLayout.vue` and `pages-standard/AdminLayout.vue` named one file.
 */
export function buildImportMap(table: MoveTable): Map<string, string> {
    const map = new Map<string, string>();

    for (const [from, to] of Object.entries(table.moves)) {
        if (!PUBLIC_PREFIXES.some((prefix) => to.startsWith(prefix))) continue;

        if (from.startsWith('components/')) {
            map.set(from, to);
            continue;
        }
        if (!from.startsWith('pages-standard/')) continue;

        const file = from.slice('pages-standard/'.length);
        if (file.includes('/')) continue;
        map.set(from, to);
        map.set(`pages/${file}`, to);
    }
    return map;
}

/**
 * What a subpath becomes, or null when it is already right.
 *
 * A `pages-standard/` path with no entry in the table is a page that did not
 * move: it keeps its name under the surviving alias.
 */
export function rewriteSubpath(map: ReadonlyMap<string, string>, subpath: string): string | null {
    const direct = map.get(subpath);
    if (direct !== undefined && direct !== subpath) return direct;
    if (subpath.startsWith('pages-standard/')) {
        return `pages/${subpath.slice('pages-standard/'.length)}`;
    }
    return null;
}

/**
 * Whether a subpath was public before and is not any more.
 *
 * Reported rather than rewritten: it moved into `features/` or `internal/`,
 * which the 1.0 surface does not publish, so there is no destination to point
 * at. Leaving it silently would hand the consumer a build error with no
 * explanation of what happened.
 */
export function isNoLongerPublic(map: ReadonlyMap<string, string>, subpath: string): boolean {
    return subpath.startsWith('components/') && !map.has(subpath);
}

/** Every `@saasicat/ui-vue/<subpath>` occurrence in a source text. */
export const UI_VUE_SPECIFIER = /@saasicat\/ui-vue\/([A-Za-z0-9/_.-]+)/g;

export interface RewriteResult {
    readonly text: string;
    readonly rewritten: number;
    /** Subpaths that lost their export, with how often each appeared. */
    readonly unmapped: ReadonlyMap<string, number>;
}

/** Applies the map to one file's text. */
export function rewriteImports(text: string, map: ReadonlyMap<string, string>): RewriteResult {
    const unmapped = new Map<string, number>();
    let rewritten = 0;

    const next = text.replace(UI_VUE_SPECIFIER, (whole, subpath: string) => {
        const to = rewriteSubpath(map, subpath);
        if (to === null) {
            if (isNoLongerPublic(map, subpath)) {
                unmapped.set(subpath, (unmapped.get(subpath) ?? 0) + 1);
            }
            return whole;
        }
        rewritten += 1;
        return `@saasicat/ui-vue/${to}`;
    });

    return { text: next, rewritten, unmapped };
}
