-- At most ONE draft (publishedAt IS NULL) per version lineage.
CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_draft_per_plan
    ON plan_versions ("planId") WHERE "publishedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bundle_versions_draft_per_bundle
    ON bundle_versions ("bundleId") WHERE "publishedAt" IS NULL;
