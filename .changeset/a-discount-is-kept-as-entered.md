---
'@saasicat/core': minor
'@saasicat/nest': patch
'@saasicat/adapter-prisma': patch
'@saasicat/adapter-drizzle': patch
'@saasicat/persistence-testing': major
---

Keep a promo code's amounts as entered, and save every field of a change

Both adapters rounded a promo code's discount and minimum amount with
`toFixed(2)` before storing them, which rounds the binary double rather than
the decimal the operator typed: 1.005 was stored as 1.00, 10.005 as 10.01. The
decimal that was entered now goes to the column, and the admin API refuses an
amount with more than two decimal places, or larger than its column holds
(999,999.99 for a discount, 99,999,999.99 for a minimum), with a 400 instead of
rounding it or failing in the database. Exponent notation such as `1e-7` is
counted too.

`@saasicat/adapter-drizzle` also dropped most of a change to a code: an edit of
the discount, its type, the minimum, the plans and cycle it applies to, the
duration, the start date and the accounting fields reported success and kept
the old values. It now writes every field the change names.

- `toDecimalString` is new in `@saasicat/core`: the decimal a number was
  written as, for a `numeric` column.
- The persistence contract creates a code with amounts that binary rounding
  would send the wrong way and changes every field of one. A promo code
  repository of your own that runs the contract has to pass both.
