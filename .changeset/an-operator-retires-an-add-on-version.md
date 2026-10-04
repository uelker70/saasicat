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
  (`SC-BUN-041`), counted from delivery — for plan versions too. A notice still
  waiting holds no announcement back; when it can go out at last, it waits
  instead while another was told within the twelve months (`SC-SUB-038`
  supersedes `SC-SUB-036` to say so).
- **Every plan from the date.** The replacement has to run beside the plan each
  booking runs beside at its date — a scheduled change and a told retirement of
  the plan version included, which the notice's prices follow too — and beside
  every plan the subscription is set to move to after it (`SC-BUN-044`). After
  an announcement, the tenant's own plan change, a plan version's retirement
  onto another plan and its early switch are refused where the version a booking
  continues on could not run beside the plan the subscription moves to: while
  that date is ahead and the booking is not cancelled yet,
  `BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN` and
  `RETIREMENT_SWITCH_BUNDLE_REPLACEMENT_CANNOT_FOLLOW` name that version and its
  date, since cancelling it then ends it before the date. A notice that waited
  goes out only while what it announces still fits at its date — an add-on's
  replacement beside the plans the booking meets, a plan's replacement with the
  add-ons then held; until then it waits.
- **Cancelling.** Until its date, a booking it reached is cancelled without its
  minimum term, at the end of the period running; the tenant's route and its
  preview decide that by the server's clock, and
  `CancelBundleFromSubscriptionInput` and `previewCancel` take
  `minimumTermLapses`. A booking it did not reach is not reinstated while it
  runs: `BUNDLE_RETIREMENT_REINSTATE_REFUSED` names the day the replacement can
  be booked from (`bookableFrom`),
  `BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS` says the subscription ends by
  then too, and `BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN` that the
  replacement cannot run beside the subscription's plans. A booking cancelled to
  end by its date no longer shows the retirement.
- **New refusals** in the preview: `BUNDLE_RETIREMENT_VERSION_ON_SALE`,
  `BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE`,
  `BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE`,
  `BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN` and
  `BUNDLE_RETIREMENT_NOTHING_AFFECTED`. An announcement is audited as
  `BUNDLE_VERSION_RETIRE`.
- **Ports.** `SubscriptionBundleRepository.listOfVersion` and
  `SubscriptionUsagePort.listByIds` are optional and in both shipped adapters; a
  start with confirmed terms is refused without them. The persistence contract
  gains the `bundleVersionRetirements` member and the gaps
  `bundleVersionRetirements`, `bookingsOfVersion` and `subscriptionsById`.
  `PlanAhead` carries an optional `by`: what moves the subscription to that
  plan, a change it scheduled or a retirement it was told of.
- **Admin UI.** The status of an add-on version no longer on sale offers
  "Retire…", with a dialog that shows the list prices, the dates, the bookings
  not reached and every blocker before anything is sent, and a retired version
  says onto which version and how far that has come. New:
  `useBundleVersionRetirement`, the `bundleVersionRetirements` resource and the
  catalogue keys `bundles.retireDialog.*` and `bundles.statusBanner.retire*`,
  `retired*` and `retirementsUnreadable`. The plan cockpit and the add-on page
  share the dialog and the progress words, which move from
  `planDetail.versions.retiredProgress.*`, where 1.0.0-rc.24 put them, to
  `common.retirementProgress.*`; the progress chip's class moves from
  `pd-retirement-progress` to `sa-retirement-progress`. An application that
  overrides either renames it. A deleted add-on now reads "Deleted"; its keys
  are unchanged.
- **Tenant UI.** The plan section's add-on list and `MySubscriptionBundlesPage`
  show the retirement beside the booked add-on (`SC-BUN-046`), for which
  `MySubscriptionBundlesPage` takes the optional `formatCurrency`,
  `quotaLabel`, `featureLabel` and `formatQuotaValue`. A refused reinstatement
  is said in the reader's language. The bookings carry `retirement`.
