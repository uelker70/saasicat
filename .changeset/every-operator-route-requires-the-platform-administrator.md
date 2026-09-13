---
'@saasicat/nest': patch
---

Every operator route `SaaSiCatModule.forRoot` mounts requires the platform
administrator

The catalogue, discovery, the admin manifest and the settings endpoint now run
`SuperAdminGuard` after `controller.guards`, as the administration, promo codes
and statistics already did. `controller.guards` establishes who is calling:
pass `[JwtAuthGuard]` or its equivalent there, not a role check, because the
tenant manifest falls back to the same list.

- An application that already listed `SuperAdminGuard` in `controller.guards`
  keeps working, and can drop it from there.
- A test or smoke run that passed `controller: { guards: [] }` and called one of
  these routes now needs a signed-in platform administrator on the request.
- An application that wires `CatalogModule`, `DiscoveryModule`,
  `AdminManifestModule`, `SettingsModule` or `PlanCatalogImporterModule` itself
  passes its whole guard chain as before, and should make sure that chain ends
  in `SuperAdminGuard`.
