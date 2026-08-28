---
'@saasicat/nest': minor
---

Booking an add-on now asks for the tenant administrator role

Three routes on the subscription-bundles controller change what a tenant pays —
booking an add-on, cancelling one and reactivating one — and they carried no
role check. The class had `ComposedTenantAuthGuard` alone, which establishes who
is calling and for which tenant but says nothing about what they may do, and the
factory's `extraGuards` parameter defaulted to an empty list. An installation
that did not think to pass a role guard let every signed-in user of the tenant
buy and cancel add-ons.

The neighbouring `TenantBillingController` names `TenantAdminGuard` on seven
routes for the same class of action, so the default was the defect rather than
the consumers' omission — and no consumer passed one.

Reading the booked add-ons, looking up a price and previewing a booking stay
open to every authenticated tenant user. Someone who cannot see what a booking
would cost cannot decide to ask an administrator for it.

**If your application let non-administrators book add-ons, they now receive
`403 TENANT_ADMIN_REQUIRED`.** Applications that already send a role — the
example does — need no change. `extraGuards` still works and still composes:
whatever you pass is applied on top.

A repository test now holds the wider rule rather than a list of the three:
every route on that controller that changes something asks for the role, unless
it is named as an exception with the reason it writes nothing.
