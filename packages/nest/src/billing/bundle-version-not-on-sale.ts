import { CATALOG_ERROR_CODES, type BundleRow, type BundleVersionRow } from '@saasicat/core';

import { bundleVersionNotBookableReason } from '../checkout-offer/bundle-version-bookable.js';

/** A refusal as a tenant's booking and its preview both say it. */
export interface BundleBookingRefusal {
    code: string;
    message: string;
    params: Record<string, string>;
}

/**
 * Why a tenant cannot book `version` at `asOf`, or `null` when they can — by
 * the window `findActiveBundleVersion` reads, so the catalogue shows what a
 * booking accepts. A version superseded with its window still open is on sale;
 * one whose successor has taken over reads as superseded. `bundle` is the
 * add-on the version belongs to: once it is deleted, none of its versions is
 * on sale, whatever their dates say.
 */
export function bundleVersionNotOnSale(
    version: BundleVersionRow,
    bundle: Pick<BundleRow, 'deletedAt'> | null,
    asOf: Date,
): BundleBookingRefusal | null {
    const reason = bundleVersionNotBookableReason(version, bundle, asOf.getTime());
    const bundleVersionId = version.id;
    switch (reason) {
        case null:
            return null;
        case 'bundle_deleted':
            return {
                code: CATALOG_ERROR_CODES.BUNDLE_DELETED,
                message: `Bundle '${version.bundleKey}' has been deleted from the catalogue and cannot be booked.`,
                params: { bundleKey: version.bundleKey },
            };
        case 'not_published':
            return {
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_PUBLISHED,
                message: `BundleVersion '${bundleVersionId}' is not published and cannot be booked.`,
                params: { bundleVersionId },
            };
        case 'not_yet_valid': {
            const validFrom = (version.validFrom ?? '').slice(0, 10);
            return {
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_YET_ON_SALE,
                message: `BundleVersion '${bundleVersionId}' goes on sale on ${validFrom} and cannot be booked before.`,
                params: { bundleVersionId, validFrom },
            };
        }
        case 'superseded':
        case 'expired':
            return {
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_SUPERSEDED,
                message: `BundleVersion '${bundleVersionId}' has been superseded by a newer version.`,
                params: { bundleVersionId },
            };
    }
}
