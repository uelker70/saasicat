# Self-registration — advanced, hand-wired

`RegistrationModule` implements the flow where a **prospect signs themselves up**:
mail address, OTP, plan choice, payment, activation. It is the one substantial
subsystem `SaaSiCatModule` does not compose for you, and this page exists so you
find that out here rather than three days in.

## Is this the page you need?

No, if your tenants are created by an operator — through the SuperAdmin UI, a
CLI command, or your own onboarding form. `SaaSiCatModule` covers that, and this
module adds nothing to it.

Yes, if a stranger with a credit card is meant to become a paying tenant without
anyone at your company touching anything.

## What it costs

`RegistrationModule.forRoot()` takes **ten required ports** and offers six
optional ones. No persistence bundle supplies any of them, and the module is not
reachable through `SaaSiCatModule` — you import and wire it yourself.

| Port                            | What it does                                         |
| ------------------------------- | ---------------------------------------------------- |
| `pendingRegistrationRepository` | Half-finished registrations (8 methods)              |
| `otpDelivery`                   | Sends the verification code                          |
| `userAccountLookup`             | Answers "is this mail address already an account?"   |
| `slugAvailabilityCheck`         | Answers "is this tenant slug free?"                  |
| `passwordHasher`                | Your hashing choice — the platform does not pick one |
| `planCatalogLookup`             | The plans a prospect may choose from                 |
| `paymentProvider`               | Your payment integration                             |
| `paymentEventLog`               | Records what the provider said                       |
| `activationOrchestrator`        | Turns a completed registration into a real tenant    |
| `auditLogger`                   | Records the steps for the audit trail                |

Optional: `resumeTokenSigner`, `resumeDelivery`, `configuratorLookup`,
`promoPreview`, and the two configurator lookups behind them.

Several of those are genuinely app-specific — `paymentProvider` and
`activationOrchestrator` encode decisions no framework can make for you. Others
(`pendingRegistrationRepository`, `slugAvailabilityCheck`) are the kind of thing
a persistence bundle would normally supply, and one day should.

## Why it is not in `SaaSiCatModule`

Three options were weighed:

1. Fold it in, and have the persistence bundles supply the ports.
2. Split it into its own package.
3. Leave it where it is and document the cliff.

**Three, for now.** The ports have no executable contract:
`@saasicat/persistence-testing` covers the catalogue, subscription, promo and
audit ports against a real PostgreSQL for both adapters, and covers none of
these ten. Folding unverified ports into a bundle, or cutting a package around
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
            // … the remaining eight
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
