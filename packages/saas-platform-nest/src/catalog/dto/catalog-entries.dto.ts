// DTOs for the catalog-entries endpoints (discovery review, SPEC_V2 §6.3 + #20).

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

    /** Filter for features/quotas (approval lifecycle). */
    @IsOptional()
    @IsString()
    @IsIn(REVIEW_STATUSES as unknown as string[])
    discoveryStatus?: string;

    /** Filter for capabilities (read-only code facts). */
    @IsOptional()
    @IsString()
    @IsIn(CODE_STATUSES as unknown as string[])
    codeStatus?: string;
}

/**
 * Body of `PATCH …/{features,quotas}/:key/review` — target status of the
 * approval state machine (#20). Allowed transitions are validated by the service.
 */
export class ReviewCatalogEntryDto {
    @IsString()
    @IsIn(REVIEW_STATUSES as unknown as string[], {
        message: 'discoveryStatus muss pending|approved|outdated|obsolete sein',
    })
    discoveryStatus!: DiscoveryStatus;
}

/** Body of `PATCH …/{features,quotas}/:key/i18n`. */
export class UpdateCatalogEntryI18nDto {
    @IsObject()
    i18n!: CatalogEntryI18n;
}

/** Body of `PATCH …/{features,quotas}/:key` — editable base fields (DE). */
export class UpdateCatalogEntryBaseDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    label?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    // Feature-only (#13): icon = Quasar icon name, tier = free-form tier hint.
    // Quotas ignore both. No @IsIn lock on tier (FeatureTier is an open union).
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
 * Body of `POST …/discovery/sync` — the discovery snapshot the UI
 * previously loaded from `GET /admin/discovery`. Validated by the service
 * against `projectKey`; deep validation is not needed because the
 * SuperAdmin guard secures the source.
 */
export class SyncDiscoveryDto {
    @IsObject()
    snapshot!: DiscoverySnapshot;
}
