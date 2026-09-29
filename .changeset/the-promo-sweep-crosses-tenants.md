---
'@saasicat/nest': patch
---

Run the nightly promo code sweep under the RLS bypass

`PromoCodeExpirer` expired codes, redemptions and holds with no bypass around
them. On an installation with a tenant policy on `promo_code_redemptions` —
forced, in some — the run expired nothing and still reported success: a
redemption past its end stayed active until an operator happened to open the
code. The sweep works for the installation, not for a tenant, and now runs
inside the `RlsBypassPort` the platform is given.
