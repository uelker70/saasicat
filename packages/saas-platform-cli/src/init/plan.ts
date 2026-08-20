// What `saasicat init` writes, decided before anything is written.
//
// The frontend has had a one-command generator since the beginning; the backend
// had a markdown file to copy from. That is the wrong way round — the frontend
// was the easy half. Thirteen files by hand, seven of them new, and none of it
// stated anywhere: you find out while doing it.
//
// Pure on purpose. Which files, under which names, with which substitutions is
// a decision that can be checked without a filesystem — and `--dry-run` is then
// the same code path as the real run rather than a second implementation of it.
// Still pure with the key check: the schema is a JSON module, not a file read.

import {
    assertValidProjectKey,
    assertValidQuotaKey,
    minimumQuotasPerPlan,
} from './catalog-keys.js';

/** What the caller asked for. */
export interface InitOptions {
    /** The catalogue this app administers. Also the storage-key prefix. */
    projectKey: string;
    /** Human name in the manifest and the YAML. Defaults to `projectKey`. */
    appName?: string;
    /** Admin API prefix, e.g. `/api/v1/admin`. */
    apiBase?: string;
    /**
     * Countable dimensions, as `key:Model` — `notes:Note` means a quota
     * `notes` counted with `prisma.note.count()`.
     */
    quotas?: readonly string[];
    /** Skip the password hasher when the app already has one. */
    skipHasher?: boolean;
}

/** One file the generator will write. */
export interface PlannedFile {
    /** Path relative to the app root. */
    readonly path: string;
    /** Template path relative to `templates/init/`, without `.tpl`. */
    readonly template: string;
    /** Substitutions for this file, on top of the shared ones. */
    readonly tokens: Readonly<Record<string, string>>;
}

export interface InitPlan {
    readonly files: readonly PlannedFile[];
    readonly tokens: Readonly<Record<string, string>>;
    /**
     * The quota providers `app.module.ts` has to register, with the file each
     * one was written to.
     *
     * The path is carried rather than re-derived. It was re-derived, from the
     * class name, while the file was named from the quota key — two spellings
     * of one name that agree for `notes` and part company for `apiCalls`:
     * `apicalls-quota.provider.ts` written, `./saas/api-calls-quota.provider`
     * imported, TS2307. The same shape as the persistence import a round
     * earlier: a fix in the plan that its caller did not follow.
     */
    readonly quotaProviders: readonly QuotaProviderFile[];
    /** The hasher class, or null when the caller brings their own. */
    readonly hasherClass: string | null;
}

/** A parsed `--quota=key:Model` entry. */
export interface QuotaProviderFile {
    /** The class the module registers. */
    readonly className: string;
    /** Where the plan writes it, relative to the project root. */
    readonly path: string;
}

export interface QuotaSpec {
    readonly key: string;
    /** The Prisma delegate to count, e.g. `note`. */
    readonly model: string;
}

/**
 * Reads `key:Model`, or `key` when the model matches the key.
 *
 * The model is lower-camelised because that is what Prisma calls its delegate:
 * a `Note` model is `prisma.note`, a `TeamMember` is `prisma.teamMember`. A
 * generated file that named the model instead would not compile, and the
 * failure would look like a schema problem.
 */
export function parseQuota(spec: string): QuotaSpec {
    const [key, model] = spec.split(':');
    if (!key) throw new Error(`--quota needs a key: got '${spec}'`);
    // Before it reaches the YAML: the plan's `quotas` object forbids additional
    // properties, so a key with a separator is refused at boot — after every
    // file has been written.
    assertValidQuotaKey(key);
    return { key, model: delegateName(model ?? key) };
}

const delegateName = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Every plan needs at least one quota, and that is the schema's rule, not ours.
 *
 * `quotas` is required on `PlanDef` and carries `minProperties: 1`, so a
 * catalogue with `quotas: {}` is not loadable — `init` used to write exactly
 * that whenever `--quota` was omitted, which is the form the help text showed
 * as the primary one. The generator cannot satisfy the rule by inventing a
 * quota: what is countable is the one thing only the integrator knows.
 */
function assertEnoughQuotas(quotas: readonly QuotaSpec[]): void {
    const minimum = minimumQuotasPerPlan();
    if (quotas.length >= minimum) return;
    throw new Error(
        `init needs at least ${minimum} --quota=<key>:<Model>. Every plan in ` +
            'config/saas.yaml must declare one, and the platform refuses a catalogue ' +
            'without it — so a project generated without one cannot boot. Name what ' +
            'your app counts, for example --quota=notes:Note; the generated provider ' +
            'is where you say how to count it.',
    );
}

/** `notes` → `Notes`, `team-members` → `TeamMembers`. */
export function pascalCase(value: string): string {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

/** `notes` → `notes-quota.provider.ts`. */
const quotaFileName = (key: string): string =>
    `${key.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-quota.provider.ts`;

/**
 * Everything the generator will do, as data.
 *
 * The quota block in the YAML is rendered here rather than in the template
 * because it varies in LENGTH — a template can substitute a value, not repeat
 * a section, and a template language that could would be a second thing to
 * learn for the one file that needs it.
 */
export function planInit(options: InitOptions): InitPlan {
    const projectKey = options.projectKey;
    if (!projectKey) throw new Error('init needs a --project-key.');
    // Before anything is planned, let alone written: the platform validates
    // the generated `config/saas.yaml` against this same pattern at boot.
    assertValidProjectKey(projectKey);

    // Two names out of one option, because it feeds two things with different
    // alphabets. `--app-name="My App"` is an ordinary answer to "what is your
    // app called" — and it produced `export class My AppAdminModule`, which is
    // not TypeScript, after the generator had written every file. The raw value
    // stays for the YAML and the labels a human reads; identifiers get the
    // PascalCase of it.
    const appLabel = options.appName ?? pascalCase(projectKey);
    const appName = pascalCase(appLabel);
    const apiBase = options.apiBase ?? '/api/v1/admin';
    const quotas = (options.quotas ?? []).map(parseQuota);
    assertEnoughQuotas(quotas);
    const hasherClass = options.skipHasher ? null : `${appName}PasswordHasher`;
    const featureKey = `${projectKey.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_CORE`;

    const shared: Record<string, string> = {
        PROJECT_KEY: projectKey,
        APP_NAME: appName,
        APP_LABEL: appLabel,
        API_BASE: apiBase,
        FEATURE_KEY: featureKey,
        REGISTRY_CONST: `${constantCase(projectKey)}_FEATURE_UI_REGISTRY`,
        MANIFEST_CONST: `${constantCase(projectKey)}_MANIFEST_CONTRIBUTION`,
        ADMIN_MODULE_CLASS: `${appName}AdminModule`,
        HASHER_CLASS: hasherClass ?? '',
        HASHER_FILE: hasherClass ? `${kebabCase(appName)}-password.hasher` : '',
        STARTER_QUOTAS: renderQuotaBlock(quotas, 25),
        PRO_QUOTAS: renderQuotaBlock(quotas, 1000),
    };

    const files: PlannedFile[] = [
        { path: 'config/saas.yaml', template: 'config/saas.yaml', tokens: {} },
        {
            path: 'src/saas/feature-ui-registry.ts',
            template: 'src/saas/feature-ui-registry.ts',
            tokens: {},
        },
        {
            path: 'src/saas/admin-manifest.contribution.ts',
            template: 'src/saas/admin-manifest.contribution.ts',
            tokens: {},
        },
        {
            path: `src/saas/${kebabCase(appName)}-admin.module.ts`,
            template: 'src/saas/admin.module.ts',
            tokens: {},
        },
    ];

    // The persistence bundle is always generated — an app without one fails
    // `core.adapters-bound` on its first boot, which is the opposite of what
    // this command is for. `--skip-hasher` only drops the `passwordHasher:`
    // line and the file behind it; the template branches on
    // `HASHER_IMPORT`/`HASHER_LINE` rather than on the file existing.
    // Two templates rather than one with a conditional line. A generator that
    // builds an `import … from '…'` in a string is read as a real import by
    // `tests/dist-is-self-contained.test.js`, which scans the emitted bundle —
    // and the way around that is either obfuscating the string or teaching a
    // repo-wide guard about this file. Two templates that differ by two lines
    // is the cheaper honesty.
    files.push({
        path: 'src/saas/persistence.ts',
        template: hasherClass
            ? 'src/saas/persistence.ts'
            : 'src/saas/persistence-without-hasher.ts',
        tokens: {},
    });
    if (hasherClass) {
        files.push({
            path: `src/auth/${kebabCase(appName)}-password.hasher.ts`,
            template: 'src/auth/password.hasher.ts',
            tokens: {},
        });
    }

    const quotaProviders: QuotaProviderFile[] = quotas.map((quota) => ({
        className: `${pascalCase(quota.key)}QuotaProvider`,
        path: `src/saas/${quotaFileName(quota.key)}`,
    }));

    for (const quota of quotas) {
        files.push({
            path: `src/saas/${quotaFileName(quota.key)}`,
            template: 'src/saas/quota.provider.ts',
            tokens: {
                QUOTA_KEY: quota.key,
                QUOTA_LABEL: `${pascalCase(quota.key)} count`,
                QUOTA_CLASS: `${pascalCase(quota.key)}QuotaProvider`,
                QUOTA_MODEL: quota.model,
            },
        });
    }

    return {
        files,
        tokens: shared,
        quotaProviders,
        hasherClass,
    };
}

/** `notes-app` → `NOTES_APP`. */
const constantCase = (value: string): string => value.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();

/** `NotesApp` → `notes-app`. */
export const kebabCase = (value: string): string =>
    value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .toLowerCase();

/**
 * The `quotas:` block of one plan, including its own separator.
 *
 * The separator belongs here rather than in the template: a nested mapping
 * starts on the next line, an empty one is ` {}` on the same one, and a
 * template that wrote `quotas: __TOKEN__` would leave a trailing space on
 * every generated file that has quotas.
 */
function renderQuotaBlock(quotas: readonly QuotaSpec[], limit: number): string {
    if (quotas.length === 0) return ' {}';
    return quotas.map((quota) => `\n          ${quota.key}: ${limit}`).join('');
}

/** Replaces `__TOKEN__` with its value; an unknown token is left visible. */
export function applyTokens(content: string, tokens: Record<string, string>): string {
    return content.replace(/__([A-Z_]+)__/g, (full, key: string) =>
        tokens[key] === undefined ? full : tokens[key],
    );
}

/**
 * The patch options a plan implies.
 *
 * Here rather than in `bin/saasicat.js`, and that is the point of the move:
 * both leftovers of the first review round were in this derivation, where
 * `plan.ts` and `patchAppModule` were each tested and the step between them was
 * not. `persistenceImport` hung on `hasherClass` while the plan had started
 * writing the bundle in both cases, so `--skip-hasher` produced an app whose
 * persistence file existed and was never imported.
 *
 * Read off the plan's own file list, so a file that is generated is a file that
 * is wired, and the two cannot drift again.
 */
export function patchOptionsFor(plan: InitPlan): PatchOptionsFromPlan {
    const generates = (path: string) => plan.files.some((file) => file.path === path);
    return {
        persistenceImport: generates('src/saas/persistence.ts') ? './saas/persistence' : null,
        adminModule: {
            className: plan.tokens.ADMIN_MODULE_CLASS!,
            importPath: `./saas/${kebabCase(plan.tokens.APP_NAME!)}-admin.module`,
        },
        // Read off the plan, not re-derived: the file it wrote is the file the
        // import has to name.
        quotaProviders: plan.quotaProviders.map(({ className, path }) => ({
            className,
            importPath: `./${path.replace(/^src\//, '').replace(/\.ts$/, '')}`,
        })),
        registry: {
            constName: plan.tokens.REGISTRY_CONST!,
            importPath: './saas/feature-ui-registry',
        },
    };
}

/** What `patchAppModule` takes, derived from a plan. */
export interface PatchOptionsFromPlan {
    persistenceImport: string | null;
    adminModule: { className: string; importPath: string };
    quotaProviders: Array<{ className: string; importPath: string }>;
    registry: { constName: string; importPath: string };
}
