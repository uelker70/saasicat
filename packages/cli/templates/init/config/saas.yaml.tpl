schemaVersion: 1

app:
    name: __APP_LABEL__
    label: __APP_LABEL__ Cockpit

currency: EUR
vatRate: 19.0

marketing:
    availableLocales: [en]

# The quickstart path: plans live here, and `loadPlanCatalogFromFile` reads
# them at boot. Apps that let operators manage plans in the SuperAdmin UI drop
# this block and pass `dbCatalog` instead — see docs/quickstart.md.
plans:
    - id: STARTER
      name: Starter
      monthlyNet: 9
      yearlyNet: 90
      features: [__FEATURE_KEY__]
      quotas:__STARTER_QUOTAS__
    - id: PRO
      name: Pro
      popular: true
      monthlyNet: 29
      yearlyNet: 290
      features: [__FEATURE_KEY__]
      quotas:__PRO_QUOTAS__
