// What a version offer leaves to a retirement told for the version a
// subscription or a booking is on (`SC-SUB-040`, `SC-BUN-057`).
//
// The retirement has its own way to the replacement: the early switch, at no
// more than the subscriber paid until the date (`SC-SUB-032`, `SC-BUN-054`).
// An offer of the replacement would be the same move at another price, so the
// replacement is the switch's to offer. And a version that takes something
// away would be scheduled for the end of a term the retirement's date may
// come first, to be made from whatever version the retirement moved the
// subscription to — so it waits until the retirement has moved it, and is then
// judged against the replacement. A newer version that applies at once leaves
// the retired version behind before the date, and stands beside the notice.
//
// In a trial the early switch waits for the trial to end, and the replacement
// waits with it: taken before then, a dearer replacement would cost from the
// conversion what the switch would hold until the date.

import type { VersionOfferClass } from '@saasicat/core';

/**
 * Whether the offer of the version `versionId`, of the kind `kind`, is left
 * to a retirement whose replacements the subscriber was told of — none where
 * no retirement reaches the version the subscriber is on.
 */
export function leftToTheRetirement(
    offered: { readonly versionId: string; readonly kind: VersionOfferClass },
    replacementsTold: readonly string[],
): boolean {
    if (replacementsTold.length === 0) return false;
    return offered.kind === 'takes-something-away' || replacementsTold.includes(offered.versionId);
}
