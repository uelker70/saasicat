import { CATALOG_ERROR_CODES } from './error-codes.js';
import { PersistenceRefusal } from './errors.js';
import { refusal } from './refusal.js';

/** The two versioned catalogue entities, by the name their rows go by. */
export type CatalogVersionKind = 'PlanVersion' | 'BundleVersion';

/**
 * Each case's code, and the name its message interpolates the id under. The
 * catalogue says `bundleVersionId` for a bundle version that is not found and
 * `versionId` for the other three; a client that localizes by code and params
 * shows the bare placeholder where the two disagree. A draft that already
 * exists is named by its plan's or bundle's key.
 */
const CASES = {
    PlanVersion: {
        gone: { code: CATALOG_ERROR_CODES.PLAN_VERSION_NOT_FOUND, param: 'versionId' },
        published: { code: CATALOG_ERROR_CODES.PLAN_VERSION_ALREADY_PUBLISHED, param: 'versionId' },
        draft: { code: CATALOG_ERROR_CODES.PLAN_DRAFT_ALREADY_EXISTS, param: 'planKey' },
    },
    BundleVersion: {
        gone: { code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND, param: 'bundleVersionId' },
        published: {
            code: CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED,
            param: 'versionId',
        },
        draft: { code: CATALOG_ERROR_CODES.BUNDLE_DRAFT_ALREADY_EXISTS, param: 'bundleKey' },
    },
} as const;

/** A publish of a version that is not there, refused with the platform's code. */
export function catalogVersionGone(
    kind: CatalogVersionKind,
    versionId: string,
): PersistenceRefusal {
    const { code, param } = CASES[kind].gone;
    return new PersistenceRefusal(code, 'gone', `${kind} '${versionId}' not found.`, {
        [param]: versionId,
    });
}

/**
 * A publish or discard of a version somebody published first. A published
 * version is what tenants may have booked, so it is neither published a second
 * time — which would rewrite when and by whom — nor discarded.
 */
export function catalogVersionAlreadyPublished(
    kind: CatalogVersionKind,
    versionId: string,
): PersistenceRefusal {
    const { code, param } = CASES[kind].published;
    return new PersistenceRefusal(
        code,
        'moved',
        `${kind} '${versionId}' is already published; it is not published again or discarded.`,
        { [param]: versionId },
    );
}

/**
 * A draft asked for where the plan or bundle already has one: there is one
 * draft at a time, so that publishing it is never a choice between two.
 */
export function catalogDraftExists(
    kind: CatalogVersionKind,
    key: string,
    draftVersion: number,
): PersistenceRefusal {
    const { code, param } = CASES[kind].draft;
    return refusal(code, 'moved', { [param]: key, draftVersion });
}
