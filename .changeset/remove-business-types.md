---
'@saasicat/types': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/spec': minor
---

Remove the BusinessType catalog concept across the public contracts, NestJS
modules, persistence adapters, UI, OpenAPI specification, and canonical database
schema. Subscriptions now always reference a plan version; bundles remain the
only composable catalog add-on.
