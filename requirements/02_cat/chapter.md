---
title: Capabilities, features and quotas
---

Before anything can be sold, somebody has to say what the application can do. This chapter covers
the path from a declaration in code to an entry an operator may put in a plan. The point of it is
that there is only ever one list: the code is the source, and the catalogue is a reviewed
projection of it rather than a second thing to keep in step.

### SC-CAT-001 — What the application can do is declared next to the code that does it

🟢 There is no separate spreadsheet or hard-coded feature list to keep in step with the
implementation.

_Source:_ `docs/explanation/capability-to-contract.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — capability/feature aggregation
        - aggregates capabilities with the same feature into a DiscoveredFeature
        - capabilities without a feature do not end up in feature aggregates
        - snapshot contains no bundles field (bundles only from SuperAdmin UI)

<!-- END proof -->

### SC-CAT-002 — Nothing a developer declares is sold automatically

🟢 New and changed declarations are presented for review. A product owner accepts them into the
catalogue; until then they are visible and not sellable. Discovery is a controlled way to let code
reality into the product, not an automatic one.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-CAT-003 — Only approved features and quotas may be put in a plan or a bundle

🟢 A key that code declares but nobody has reviewed cannot be sold, and publishing a version that
names one is refused.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-strict-mode.test.js`
    - validatePlanDraft (pure)
        - all present → no warnings
        - unknown feature → PLAN_FEATURE_UNKNOWN
        - unknown quota key → QUOTA_MISSING
        - multiple violations → multiple warnings, sorted by features[]/quotas{}
        - PLAN_FEATURE_UNKNOWN is disjoint from BUNDLE_FEATURE_UNKNOWN
    - PlanVersionsService — strict mode integration
        - warn-only: createDraft with unknown feature → 201 + warnings[]
        - blocking: createDraft with unknown feature → 422
        - blocking: createDraft with unknown quota → 422 with QUOTA_MISSING
        - blocking: all present → 201 + warnings=[]
        - blocking without snapshot source → degrades to warn-only instead of crashing (#25)
        - blocking: marketed-only feature → NO 422 (allowlist)
        - blocking: NON-allowlisted unknown feature → still 422
        - scanner fallback (#25): blocking without token but with DiscoveryScanner enforces
          correctly
        - warn-only without snapshot → no check, warnings=[]
        - blocking: publishPlanVersion runs the strict check on publish too
        - updatePlanDraft in blocking: drift is rejected
- `packages/nest/tests/seed-gate.test.js`
    - validateSeedAgainstSnapshot
        - all seeded features discovered → overall ok
        - plan with an undiscovered feature → PLAN_FEATURE_UNKNOWN + error
        - bundle with an undiscovered feature → BUNDLE_FEATURE_UNKNOWN
        - undiscovered quota → QUOTA_MISSING
        - empty input → ok
        - formatSeedGateReport shows entity + code

<!-- END proof -->

### SC-CAT-004 — A plan may not reference something no code implements

🟢 A feature no code declares and a limit nothing counts cannot be sold. Code is the source of truth
for what exists.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-strict-mode.test.js`
    - validatePlanDraft (pure)
        - all present → no warnings
        - unknown feature → PLAN_FEATURE_UNKNOWN
        - unknown quota key → QUOTA_MISSING
        - multiple violations → multiple warnings, sorted by features[]/quotas{}
        - PLAN_FEATURE_UNKNOWN is disjoint from BUNDLE_FEATURE_UNKNOWN

<!-- END proof -->

### SC-CAT-005 — A marketed non-code feature is the one narrow exception, and is configured explicitly

🟢 Something like a support commitment can be sold without any code implementing it. A feature that
is merely not built yet does not belong there.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-006 — Approval needs a scan to compare against

🟢 An installation that has not yet read its own declarations cannot accept entries into the
catalogue, and says so rather than accepting them blind.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)

<!-- END proof -->

### SC-CAT-007 — A catalogue entry moves along a fixed path

🟢 Discovered, accepted, active, deprecated, retired — or set aside as ignored. A step outside that
order is refused, so the state of an entry always says the same thing to everyone reading it.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)
- `packages/ui-vue/tests/use-discovery.test.js`
    - useDiscovery
        - the endpoint is required — there is no prefix the platform could guess
        - load() adopts the snapshot and remembers the ETag
        - the second load sends the ETag, and a 304 changes nothing
        - reload() drops the ETag, so the server has to answer with a body
        - a failed load lands on `error`, not on a rejection the page has to catch
        - rescan() posts, adopts the new snapshot and accepts 200 as well as 201
        - a failed rescan says rescan, not discovery
        - a client that rejects is reported as it is, not re-wrapped
        - a client that resolves with status 0 never reached the server
        - a client that throws a non-Error still leaves an Error behind
        - autoLoad fetches without being asked

<!-- END proof -->

### SC-CAT-008 — An approved entry whose code definition changes goes back for review

🟢 It flips to outdated by itself rather than continuing to claim an approval that was given for
something else.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)

<!-- END proof -->

### SC-CAT-009 — Bringing a retired entry back is always a person's decision

🟢 The automatic scan at start-up never reactivates one.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)

<!-- END proof -->

### SC-CAT-010 — Labels an operator has written are never overwritten by the scan

🟢 The automatic sync fills empty fields and leaves curated ones alone.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)
- `packages/ui-vue/tests/component/discovery-page-keeps-the-first-edit.test.ts`
    - DiscoveryPage carries a saved translation into the next save
        - the second payload still holds the first edit

<!-- END proof -->

### SC-CAT-011 — Four words with four meanings, kept apart

🟢 A capability is implemented, a feature is marketable, a quota is countable, and a plan or bundle
is sellable. The distinction is what lets an operator repackage the product without a developer,
and a developer refactor the code without repricing anything.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — capability/feature aggregation
        - aggregates capabilities with the same feature into a DiscoveredFeature
        - capabilities without a feature do not end up in feature aggregates
        - snapshot contains no bundles field (bundles only from SuperAdmin UI)

<!-- END proof -->

### SC-CAT-012 — A new declaration appears for review after the application restarts

🟢 The scan happens when the application starts. An operator who cannot see a colleague's new
capability is waiting for a deployment, not looking in the wrong place.

_Source:_ `docs/guides/wire-the-backend.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)
- `packages/nest/tests/discovery-controller.test.js`
    - DiscoveryController — GET /admin/discovery
        - returns the discovery snapshot as the body
        - sets the ETag header with snapshot.hash + scannedAt
        - returns HTTP 304 + null body on an If-None-Match match
        - returns the full snapshot when If-None-Match does not match
        - ignores an empty If-None-Match header

<!-- END proof -->

### SC-CAT-013 — A quota key is named in exactly one place

🟢 The declaration in code. It cannot be introduced in a configuration file, and it cannot contain a
separator that would make it ambiguous where a plan lists it.

_Source:_ release 0.2.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — Quotas
        - reads @DefinesQuota at the class level
        - cross-references @EnforceQuota on capabilities with the quota

<!-- END proof -->

### SC-CAT-014 — An unsatisfied dependency between features is advice, not a refusal

🟢 A feature that requires another one may have that other one covered by the plan, by a different
bundle, or by something the operator sells separately, and none of that is visible while a draft
is being checked. A bundle naming a plan that does not exist is refused outright, because that one
is decidable.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — requires/replaces (#35/#39)
        - capability without requires/replaces carries null (default)
        - requires/replaces are deduplicated + sorted through
        - feature aggregation: union of capability requires minus its own featureKey
        - feature aggregation: replaces as union over the capabilities
        - quota carries replaces from @DefinesQuota
        - requires change changes the snapshot hash

<!-- END proof -->

### SC-CAT-015 — A missing scan degrades the check, it does not stop the application

🟢 Where the strictest setting is configured but nothing can be compared against, the installation
warns loudly and keeps running. Crashing there once caused a production outage.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — edge cases
        - multiple declaration of the same capability: first wins
        - app info is carried into the snapshot
        - default app info when nothing is injected
        - rebuildSnapshot overwrites the cache

<!-- END proof -->

### SC-CAT-016 — The check that runs before a deployment always blocks

🟢 There is no advisory mode in the pre-deployment gate: a violation stops the deployment. The same
check runs before the first write of seeded data.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-strict-mode.test.js`
    - PlanVersionsService — strict mode integration
        - warn-only: createDraft with unknown feature → 201 + warnings[]
        - blocking: createDraft with unknown feature → 422
        - blocking: createDraft with unknown quota → 422 with QUOTA_MISSING
        - blocking: all present → 201 + warnings=[]
        - blocking without snapshot source → degrades to warn-only instead of crashing (#25)
        - blocking: marketed-only feature → NO 422 (allowlist)
        - blocking: NON-allowlisted unknown feature → still 422
        - scanner fallback (#25): blocking without token but with DiscoveryScanner enforces
          correctly
        - warn-only without snapshot → no check, warnings=[]
        - blocking: publishPlanVersion runs the strict check on publish too
        - updatePlanDraft in blocking: drift is rejected
- `packages/nest/tests/preflight.test.js`
    - runPreflight
        - empty catalog → overall=ok, total=0
        - everything present → overall=ok
        - plan with unknown feature → overall=error, kind=plan
        - bundle with unknown feature → kind=bundle, BUNDLE_FEATURE_UNKNOWN
        - findings are deterministically sorted (kind, entityKey, version, code)

<!-- END proof -->
