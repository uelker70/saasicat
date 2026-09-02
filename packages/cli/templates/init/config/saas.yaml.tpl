schemaVersion: 1

app:
    name: __APP_LABEL__
    label: __APP_LABEL__ Cockpit

currency: EUR
vatRate: 19.0

# What the tenant self-service routes may do, and on what terms. These live
# here and nowhere else — an operator reading this file has to be reading the
# values that are running, with no "unless somebody passed it in code"
# attached. The file is read at boot, so an edit lands on the next restart.
tenantBilling:
    # How many days before the term ends a cancellation is still in time.
    # Zero means there is no door to be shut out of: a cancellation on the last
    # day still lands at the term end. Raise it and the cut is hard — a
    # declaration made after the window lands one full period later, which on a
    # yearly cycle is a year.
    #
    # Two rhythms, two numbers, and both are required. A month and a year
    # cannot share a notice period, and a rhythm left out would read as zero:
    # a commercial decision nobody made.
    #
    # Any value here may name an environment variable, `monthly: ${NOTICE_DAYS}`
    # or with a default `${NOTICE_DAYS:-0}`, so one file serves every
    # environment. It is resolved before the schema checks it, so the rules
    # above still hold; a variable nobody set stops the boot and names itself.
    cancellationNoticeDays:
        monthly: 0
        yearly: 0
    # Plans a tenant may not reach or leave on its own — typically a plan that
    # only a special contract activates. Empty is a statement, not an omission:
    # it says self-service reaches every plan.
    selfServiceBlockedPlans:
        asTarget: []
        asSource: []

marketing:
    availableLocales: [en]

# Who is mailed when a start finds the settings above changed since the previous
# start. The change is recorded in the administration either way; mail needs an
# email port bound as `adapters.email`, and without one the boot log says once
# that the addresses reach nobody. Nobody is named here on purpose: this example
# binds no mail, and an installation of one operator needs nothing else.
#
#   notifications:
#       settingsChanged: [ops@example.com]

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
