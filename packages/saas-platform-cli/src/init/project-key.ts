// What a project key may look like — asked of the schema, not of a copy.
//
// `saasicat init` accepted anything non-empty and wrote it into
// `config/saas.yaml`, which the platform then validates against
// `plan-catalog.schema.json` on the first boot. So `--project-key=NotesApp`
// generated an application that could not start, after the generator had
// already written every file and patched `app.module.ts` — and the command's
// own help documented `--project-key=x`, which is one character and fails the
// same pattern.
//
// The rule is imported rather than restated: `@saasicat/spec` is the schema the
// loader reads (`billing/plan-catalog-loader.ts` imports the same object), so
// this cannot drift from it. A second copy of the regex would be the defect one
// level up.

import { planCatalogSchema } from '@saasicat/spec';

interface StringSchema {
    readonly pattern?: string;
}

/** The pattern `plan-catalog.schema.json` puts on `projectKey`. */
export function projectKeyPattern(): RegExp {
    const schema = planCatalogSchema as {
        properties?: { projectKey?: StringSchema };
    };
    const pattern = schema.properties?.projectKey?.pattern;
    if (!pattern) {
        // Not a fallback regex: guessing here would reintroduce the copy this
        // module exists to avoid, and quietly accept keys the loader refuses.
        throw new Error(
            'plan-catalog.schema.json declares no pattern for projectKey — ' +
                '@saasicat/spec and @saasicat/cli are out of step.',
        );
    }
    return new RegExp(pattern);
}

/**
 * Refuses a key the platform will refuse, while nothing has been written yet.
 *
 * The message carries the pattern rather than a prose paraphrase, because the
 * paraphrase is the thing that goes stale.
 */
export function assertValidProjectKey(projectKey: string): void {
    const pattern = projectKeyPattern();
    if (pattern.test(projectKey)) return;
    throw new Error(
        `--project-key=${projectKey} is not a valid project key. ` +
            `It has to match ${pattern.source} — lower case, starting with a letter, ` +
            'at least two characters. The platform validates config/saas.yaml against ' +
            'the same pattern at boot, so this would fail after every file was written.',
    );
}
