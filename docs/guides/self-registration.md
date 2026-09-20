# Self-registration — advanced, hand-wired

`RegistrationModule` implements the flow where a **prospect signs themselves up**:
mail address, OTP, plan choice, billing address and payment method, activation. It is the one
substantial
subsystem `SaaSiCatModule` does not compose for you, and this page exists so you
find that out here rather than three days in.

## Is this the page you need?

No, if your tenants are created by an operator — through the SuperAdmin UI, a
CLI command, or your own onboarding form. `SaaSiCatModule` covers that, and this
module adds nothing to it.

Yes, if a stranger with a credit card is meant to become a paying tenant without
anyone at your company touching anything.

## What it costs

`RegistrationModule.forRoot()` takes the required ports below and offers optional
ones. No persistence bundle supplies any of them, and the module is not reachable
through `SaaSiCatModule` — you import and wire it yourself. The payment method is
the exception: it is taken through the payments module, which `SaaSiCatModule`
composes, so `payments` has to be enabled there — see
[payment methods through a gateway](wire-the-backend.md#payment-methods-through-a-gateway).

| Port                            | What it does                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `pendingRegistrationRepository` | Half-finished registrations (8 methods)                                       |
| `otpDelivery`                   | Sends the verification code                                                   |
| `userAccountLookup`             | Answers "is this mail address already an account?"                            |
| `slugAvailabilityCheck`         | Answers "is this tenant slug free?"                                           |
| `passwordHasher`                | Your hashing choice — the platform does not pick one                          |
| `planCatalogLookup`             | The plans a prospect may choose from                                          |
| `activationOrchestrator`        | Turns a completed registration into a real tenant, and creates its subscriber |
| `auditLogger`                   | Records the steps for the audit trail                                         |

Optional: `resumeTokenSigner`, `resumeDelivery`, `configuratorLookup`,
`promoPreview`, and the two configurator lookups behind them.

## Step 4: the billing address and the payment method

`startCheckout` takes the billing address — `addressLine1`, `postalCode`, `city` and `country`
(ISO 3166-1 alpha-2) are required, `addressLine2`, `vatId` and `taxNumber` optional — and opens the
payment form of the gateway account `config/saas.yaml#payments.newPaymentMethods` names. It answers
with `checkoutUrl`, where you send the person; a missing or malformed detail is refused with
`SUBSCRIBER_DETAIL_INVALID`, and a success or cancel URL outside
`config/saas.yaml#payments.returnUrlOrigins` with `PAYMENT_RETURN_URL_NOT_ALLOWED`, before the
gateway
is asked. Nothing is activated when the form opens.

What this step will ask for is what a page offering the plans has to know before it promises
anything: `GET /public/marketing-catalog` answers `newPaymentMethods` with `taken` and the `methods`
the form offers — the account this step goes to, read from the installation. One that names no
account for new payment methods, or runs without payments, answers `taken: false`, so a sign-up
screen saying "no payment method is taken" stops saying it the day a gateway is bound rather than
the day somebody notices. It says what the installation takes, not whether you run a sign-up at
all: that is your own wiring, and this guide is where you decided it.

The gateway confirms the payment method through its callback to
`POST /webhooks/payment/<account>`. The platform verifies it, claims it and activates the sign-up on
**one transaction**: it opens it, claims the confirmation on it, and hands it to your orchestrator
as `activate(pending, { tx })`; once `activate` returns, it records the payment method for the
subscriber and deletes the pending registration on the same transaction — so a sign-up is either
still waiting or activated, and a later confirmation finds nothing to activate twice. A failure
anywhere rolls all of it back — the claim included —
so the gateway's retry activates the sign-up rather than being discarded as a duplicate. Write every
row on `tx` and open no transaction of your own: a write beside it would survive the rollback that
undoes the rest.

The orchestrator creates the tenant's **subscriber** on that transaction, before any contract, and
returns its id as `subscriberId`: every contract names the party it is concluded with, and a tenant
without one is refused a contract. `subscriberFromRegistration(pending)` from `@saasicat/core` gives
the details a sign-up has — the tenant name as the legal name, the verified address for invoices,
and the billing address and tax identifiers of step 4. Concluding a checkout offer, pass the
subscriber and the transaction to `conclude`; otherwise call `SubscriberService.createForTenant` on
`tx`:

```ts
async activate(pending: PendingRegistration, { tx }: RegistrationActivation) {
    const tenantId = await createTenant(pending, tx);
    await checkoutOffers.conclude(
        offerId,
        { tenantId, effectiveFrom: new Date(), subscriber: subscriberFromRegistration(pending), tx },
        async (tx) => {
            /* create the tenant's user and its subscription on tx */
        },
    );
    /* … return { userId, tenantId, subscriberId, subscriptionId } */
}
```

`pendingRegistrationRepository` finds a sign-up by the gateway account and the session together —
`findByCheckoutSession(gatewayAccount, sessionId)` — because a session identifier is unique only
within its account —, deletes with `delete(id, tx)` on the transaction it is handed, and names the
accounts sign-ups are still waiting at —
`findOpenCheckoutAccounts(now)` — so the application refuses to start while one of them is no longer
configured.

Several of the ports are genuinely app-specific — `activationOrchestrator` encodes decisions no
framework can make for you. Others
(`pendingRegistrationRepository`, `slugAvailabilityCheck`) are the kind of thing
a persistence bundle would normally supply, and one day should.

## Why it is not in `SaaSiCatModule`

Three options were weighed:

1. Fold it in, and have the persistence bundles supply the ports.
2. Split it into its own package.
3. Leave it where it is and document the cliff.

**Three, for now.** The ports have no executable contract:
`@saasicat/persistence-testing` covers the catalogue, subscription, promo, audit
and payment ports against a real PostgreSQL for both adapters, and covers none of
these. Folding unverified ports into a bundle, or cutting a package around
them, moves the problem without checking it — and a bundle that supplies a
`pendingRegistrationRepository` nothing holds to a contract is a promise the
project cannot keep.

The order is the reason, not the effort: contract first, then the package.

## Wiring it

```ts
import { RegistrationModule } from '@saasicat/nest/registration';

@Module({
    imports: [
        SaaSiCatModule.forRoot(defineSaaSiCat({/* … */})),
        RegistrationModule.forRoot({
            // Your adapters. `extraProviders` is how their own `inject: [...]`
            // tokens become resolvable inside the module's scope.
            pendingRegistrationRepository: MyPendingRegistrationRepository,
            otpDelivery: MyOtpDelivery,
            // … the remaining ports
            imports: [PrismaModule, MailModule],
            extraProviders: [MyPendingRegistrationRepository, MyOtpDelivery],
        }),
    ],
})
export class AppModule {}
```

Two things that bite:

- **`extraProviders` is not optional in practice.** A factory port with
  `inject: [...]` cannot resolve classes the module scope has never seen, and
  strict NestJS answers that with `UnknownDependenciesException` at boot.
- **`includeCleanupCron` defaults to `true`** and registers a daily job through
  `@nestjs/schedule`. Set it to `false` where no scheduler is running — a CLI
  boot, a test harness.
