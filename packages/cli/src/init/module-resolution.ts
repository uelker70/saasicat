// What `init` needs from the consumer's tsconfig, and why it asks.
//
// The files `init` writes import `@saasicat/nest/platform`, `/billing` and
// `/discovery` — subpath exports, which TypeScript resolves only under
// `moduleResolution` `node16`, `nodenext` or `bundler`. Under the old `node`
// setting every one of those imports is "Cannot find module", in files the
// command just wrote. `nest new` has set `nodenext` for years; an app that
// predates that is exactly the app `docs/guides/integrate-into-an-existing-app.md` is
// for, so this is checked before anything is written, and said plainly.
//
// The config is read the way the build will read it: through TypeScript's
// own `readConfigFile` and `parseJsonConfigFileContent`, which see past
// comments and follow `extends`. A hand-written reader did neither — it took
// a commented-out `"moduleResolution": "node"` for the live value, and a
// base config that set it for nothing at all.

import { join } from 'node:path';

import type * as TypeScript from 'typescript';

/** The settings under which a subpath export resolves. */
const RESOLVES_SUBPATHS = new Set(['node16', 'nodenext', 'bundler']);

export interface ModuleResolutionVerdict {
    readonly ok: boolean;
    /** The effective setting, lower-cased as TypeScript names it, or null when unset. */
    readonly value: string | null;
    readonly reason?: string;
}

/**
 * Judges an effective `moduleResolution`, as `readEffectiveModuleResolution`
 * reports it.
 *
 * Unset is `ok`: TypeScript then derives it from `module`, and a `module`
 * that implies the old resolution is a setup this cannot see from here —
 * the next build says so, with TypeScript's own message.
 */
export function judgeModuleResolution(value: string | null): ModuleResolutionVerdict {
    if (value === null || RESOLVES_SUBPATHS.has(value)) {
        return { ok: true, value };
    }
    return {
        ok: false,
        value,
        reason:
            `tsconfig.json resolves modules with "moduleResolution": "${value}"` +
            (value === 'node10' ? ' (what TypeScript calls the "node" setting)' : '') +
            '. The files init writes import subpath exports (`@saasicat/nest/platform`, ' +
            '`/billing`, `/discovery`), which TypeScript resolves only under "node16", ' +
            '"nodenext" or "bundler". Set one of those first — `nest new` has used "nodenext" ' +
            'since NestJS 10.',
    };
}

/**
 * The `moduleResolution` a project's `tsconfig.json` resolves to, after
 * `extends`, lower-cased as TypeScript names the kind (`node10`, `node16`,
 * `nodenext`, `bundler`, `classic`) — or null when there is no config, the
 * config cannot be parsed, or the option is not set anywhere in the chain.
 *
 * `ts` is whichever TypeScript will compile the project: the consumer's own
 * when it can be resolved from the project root, so the reading matches the
 * build that follows.
 */
export function readEffectiveModuleResolution(root: string, ts: typeof TypeScript): string | null {
    const configPath = join(root, 'tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error || read.config === undefined) return null;
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    const kind = parsed.options.moduleResolution;
    if (kind === undefined) return null;
    return ts.ModuleResolutionKind[kind]!.toLowerCase();
}
