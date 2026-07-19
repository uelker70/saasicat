import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@saasicat/types';

// RequireFeature-Decorator — markiert einen Handler oder Controller als
// feature-pflichtig. Mehrere Keys werden als Logical-OR ausgewertet — der
// FeatureGuard lässt den Request passieren, sobald **irgendeines** der
// angegebenen Features im aktiven EntitlementSet enthalten ist.
//
// Aus autohauspro/backend/src/billing/require-feature.decorator.ts extrahiert
// (P1-Slice, UMSETZUNGSPLAN.md §3.2). Statt Prisma-Enum nimmt die
// Plattform-Variante `FeatureKey` aus saas-platform-types (string).

export const REQUIRE_FEATURE_KEY = 'require-feature';

/**
 * Tag handler with required feature keys.
 *
 * Kein Wert = öffentlich. Mehrere Werte = Logical-OR.
 */
export const RequireFeature = (...features: FeatureKey[]) =>
    SetMetadata(REQUIRE_FEATURE_KEY, features);
