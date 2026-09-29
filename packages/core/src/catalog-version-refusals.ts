import { CATALOG_ERROR_CODES } from './error-codes.js';
import { PersistenceRefusal } from './errors.js';

/** The two versioned catalogue entities, by the name their rows go by. */
export type CatalogVersionKind = 'PlanVersion' | 'BundleVersion';

const CODES = {
    PlanVersion: {
        gone: CATALOG_ERROR_CODES.PLAN_VERSION_NOT_FOUND,
        published: CATALOG_ERROR_CODES.PLAN_VERSION_ALREADY_PUBLISHED,
    },
    BundleVersion: {
        gone: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
        published: CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED,
    },
} as const;

/** A publish of a version that is not there, refused with the platform's code. */
export function catalogVersionGone(
    kind: CatalogVersionKind,
    versionId: string,
): PersistenceRefusal {
    return new PersistenceRefusal(CODES[kind].gone, 'gone', `${kind} '${versionId}' not found.`, {
        versionId,
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
    return new PersistenceRefusal(
        CODES[kind].published,
        'moved',
        `${kind} '${versionId}' is already published; it is not published again or discarded.`,
        { versionId },
    );
}
