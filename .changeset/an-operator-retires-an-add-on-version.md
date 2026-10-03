---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

An operator can retire an add-on version for the bookings on it

An add-on version no longer on sale can be retired the way a plan version is:
the bookings on it are told that they continue on the add-on's version on sale,
each at the first end of its own period at least three calendar months after
its notice reached an administrator (`SC-BUN-038` to `SC-BUN-048`). It rests on
the same `tenantBilling.orderlyRetirement.termsConfirmed`.

- **Wiring.** Adopt `prisma-fragments/19-bundle-version-retirement.prisma` and
  run `sql/1.0-an-add-on-retirement-is-announced.postgres.sql` once, or pass
  `notAdopted: ['BundleVersionRetirement']`, which leaves it off. Both shipped
  bundles provide `persistence.tenantBilling.bundleVersionRetirements`. The
  routes are `GET` and `POST /admin/catalog/bundle-versions/:id/retirement` —
  the announcement behind the second factor — and
  `GET /admin/catalog/bundle-version-retirements`; the manifest announces them
  as `bundleVersions.retire`. With `versionNotices.includeCron: false`, call
  `VersionRetirementService.sendUndelivered` and
  `BundleVersionRetirementService.sendUndelivered` from your scheduler: a
  retirement whose notice is not sent waits for it.
- **Notices.** One `bundle-version-retired` notice per booking, through the
  same `SubscriptionNoticePort`: the plan the add-on runs beside at the date,
  both versions with their prices for that plan, the booking's rhythm, the date
  and the last day to cancel without the minimum term. A port that narrows on
  `notice.kind` has to handle the new kind.
- **Twelve months, plan and add-on together.** A retirement of either kind is
  refused for a subscription told of either within twelve months
  (`SC-BUN-041`).
- **Cancelling.** Until its date, a booking it reached is cancelled without its
  minimum term, at the end of the period running; the tenant's route and its
  preview decide that by the server's clock, and
  `CancelBundleFromSubscriptionInput` and `previewCancel` take
  `minimumTermLapses`. A booking it did not reach is not reinstated:
  `BUNDLE_RETIREMENT_REINSTATE_REFUSED`.
- **New refusals** in the preview: `BUNDLE_RETIREMENT_VERSION_ON_SALE`,
  `BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE`,
  `BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE`,
  `BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN` and
  `BUNDLE_RETIREMENT_NOTHING_AFFECTED`. An announcement is audited as
  `BUNDLE_VERSION_RETIRE`.
- **Ports.** `SubscriptionBundleRepository.listOfVersion` and
  `SubscriptionUsagePort.listByIds` are optional and in both shipped adapters;
  a start with confirmed terms is refused without them. The persistence
  contract gains the `bundleVersionRetirements` member and the gaps
  `bundleVersionRetirements`, `bookingsOfVersion` and `subscriptionsById`.
- **Admin UI.** The status of an add-on version no longer on sale offers
  "Retire…", with a dialog that shows the list prices, the dates, the bookings
  not reached and every blocker before anything is sent, and a retired version
  says onto which version and how far that has come. New:
  `useBundleVersionRetirement`, the `bundleVersionRetirements` resource and the
  catalogue keys `bundles.retireDialog.*` and `bundles.statusBanner.retire*`,
  `retired*` and `retirementsUnreadable`. The plan cockpit and the add-on page
  share the dialog and the progress words, `common.retirementProgress.*`. A
  deleted add-on now reads "Deleted"; its keys are unchanged.
- **Tenant UI.** The plan section's add-on list and `MySubscriptionBundlesPage`
  show the retirement beside the booked add-on (`SC-BUN-046`), for which
  `MySubscriptionBundlesPage` takes the optional `formatCurrency`,
  `quotaLabel`, `featureLabel` and `formatQuotaValue`. A refused reinstatement
  is said in the reader's language. The bookings carry `retirement`.
