// What `init` needs from the consumer's tsconfig, and why it asks.
//
// The files `init` writes import `@saasicat/nest/platform`, `/billing` and
// `/discovery` — subpath exports, which TypeScript resolves only under
// `moduleResolution` `node16`, `nodenext` or `bundler`. Under the old `node`
// setting every one of those imports is "Cannot find module", in files the
// command just wrote. `nest new` has set `nodenext` for years; an app that
// predates that is exactly the app `docs/migrating-an-existing-app.md` is
// for, so this is checked before anything is written, and said plainly.

/** The settings under which a subpath export resolves. */
const RESOLVES_SUBPATHS = new Set(['node16', 'nodenext', 'bundler']);

export interface ModuleResolutionVerdict {
    readonly ok: boolean;
    /** What the tsconfig says, or `null` when it says nothing. */
    readonly value: string | null;
    readonly reason?: string;
}

/**
 * Reads `compilerOptions.moduleResolution` out of a tsconfig text.
 *
 * A tsconfig is JSON with comments and trailing commas, so it is not parsed
 * as JSON: the one value is read off the text. A missing value is `ok` —
 * TypeScript derives it from `module`, and a `module` that needs the old
 * resolution is a setup this command cannot see from here; the build says
 * so on the next run, with TypeScript's own message.
 */
export function judgeModuleResolution(tsconfigText: string): ModuleResolutionVerdict {
    const value = readModuleResolution(tsconfigText);
    if (value === null || RESOLVES_SUBPATHS.has(value.toLowerCase())) {
        return { ok: true, value };
    }
    return {
        ok: false,
        value,
        reason:
            `tsconfig.json sets "moduleResolution": "${value}". The files init writes import ` +
            'subpath exports (`@saasicat/nest/platform`, `/billing`, `/discovery`), which ' +
            'TypeScript resolves only under "node16", "nodenext" or "bundler". Set one of ' +
            'those first — `nest new` has used "nodenext" since NestJS 10.',
    };
}

/** The string value of `"moduleResolution"` in a tsconfig text, or null. */
export function readModuleResolution(tsconfigText: string): string | null {
    const key = '"moduleResolution"';
    const at = tsconfigText.indexOf(key);
    if (at < 0) return null;
    const colon = tsconfigText.indexOf(':', at + key.length);
    if (colon < 0) return null;
    const open = tsconfigText.indexOf('"', colon + 1);
    if (open < 0) return null;
    const close = tsconfigText.indexOf('"', open + 1);
    if (close < 0) return null;
    return tsconfigText.slice(open + 1, close);
}
