import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@saasicat/types';

// RequireFeature decorator — marks a handler or controller as
// feature-gated. Multiple keys are evaluated as a logical OR — the
// FeatureGuard lets the request through as soon as **any** of the
// given features is contained in the active EntitlementSet.
//
// Instead of a Prisma enum, the platform variant takes `FeatureKey` from
// saas-platform-types (string).

export const REQUIRE_FEATURE_KEY = 'require-feature';

/**
 * Tag handler with required feature keys.
 *
 * No value = public. Multiple values = logical OR.
 */
export const RequireFeature = (...features: FeatureKey[]) =>
    SetMetadata(REQUIRE_FEATURE_KEY, features);
