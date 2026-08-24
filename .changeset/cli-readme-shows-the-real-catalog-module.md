---
'@saasicat/cli': patch
---

The README's CLI module example wired `PlanCatalogModule.forRoot({ path })`, an
option the module has not taken since the catalogue moved into the database. It
now shows the four options it actually requires, with the Prisma read sink.
