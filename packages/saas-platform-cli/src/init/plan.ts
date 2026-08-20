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
    /** The quota provider classes `app.module.ts` has to register. */
    readonly quotaClasses: readonly string[];
    /** The hasher class, or null when the caller brings their own. */
    readonly hasherClass: string | null;
}

/** A parsed `--quota=key:Model` entry. */
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
    return { key, model: delegateName(model ?? key) };
}

const delegateName = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

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

    const appName = options.appName ?? pascalCase(projectKey);
    const apiBase = options.apiBase ?? '/api/v1/admin';
    const quotas = (options.quotas ?? []).map(parseQuota);
    const hasherClass = options.skipHasher ? null : `${appName}PasswordHasher`;
    const featureKey = `${projectKey.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_CORE`;

    const shared: Record<string, string> = {
        PROJECT_KEY: projectKey,
        APP_NAME: appName,
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
        quotaClasses: quotas.map((q) => `${pascalCase(q.key)}QuotaProvider`),
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
        quotaProviders: plan.quotaClasses.map((className) => ({
            className,
            importPath: `./saas/${kebabCase(className.replace(/QuotaProvider$/, ''))}-quota.provider`,
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
