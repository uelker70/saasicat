// DTOs für die Catalog-Entries-Endpunkte (Discovery-Review, SPEC_V2 §6.3 + #20).

import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type {
    CatalogEntryI18n,
    DiscoverySnapshot,
    DiscoveryStatus,
} from '@saasicat/types';

const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const REVIEW_STATUSES = ['pending', 'approved', 'outdated', 'obsolete'] as const;
const CODE_STATUSES = ['active', 'experimental', 'deprecated', 'retired'] as const;

export class ListCatalogEntriesQueryDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, { message: 'projectKey muss kebab-case sein' })
    projectKey!: string;

    /** Filter für Features/Quotas (Freigabe-Lifecycle). */
    @IsOptional()
    @IsString()
    @IsIn(REVIEW_STATUSES as unknown as string[])
    discoveryStatus?: string;

    /** Filter für Capabilities (read-only Code-Fakten). */
    @IsOptional()
    @IsString()
    @IsIn(CODE_STATUSES as unknown as string[])
    codeStatus?: string;
}

/**
 * Body von `PATCH …/{features,quotas}/:key/review` — Ziel-Status des
 * Freigabe-Automaten (#20). Erlaubte Übergänge validiert der Service.
 */
export class ReviewCatalogEntryDto {
    @IsString()
    @IsIn(REVIEW_STATUSES as unknown as string[], {
        message: 'discoveryStatus muss pending|approved|outdated|obsolete sein',
    })
    discoveryStatus!: DiscoveryStatus;
}

/** Body von `PATCH …/{features,quotas}/:key/i18n`. */
export class UpdateCatalogEntryI18nDto {
    @IsObject()
    i18n!: CatalogEntryI18n;
}

/** Body von `PATCH …/{features,quotas}/:key` — editierbare Basis-Felder (DE). */
export class UpdateCatalogEntryBaseDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    label?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    // Feature-only (#13): icon = Quasar-Icon-Name, tier = freier Tier-Hint.
    // Quotas ignorieren beide. Kein @IsIn-Lock auf tier (FeatureTier ist offene Union).
    @IsOptional()
    @IsString()
    @MaxLength(64)
    icon?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    tier?: string | null;
}

/**
 * Body von `POST …/discovery/sync` — der Discovery-Snapshot, den die UI
 * zuvor von `GET /admin/discovery` geladen hat. Wird vom Service gegen
 * `projectKey` validiert; deep-Validation ist nicht nötig, weil der
 * SuperAdmin-Guard die Quelle absichert.
 */
export class SyncDiscoveryDto {
    @IsObject()
    snapshot!: DiscoverySnapshot;
}
