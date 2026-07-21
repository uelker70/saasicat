// @saasicat/prisma — default Prisma adapter for the
// SaaS platform ports.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P4.
//
// Contents:
//   - PRISMA_CLIENT_TOKEN + PrismaLike — DI token + structural sub-
//     interface for consumer PrismaService bindings.
//   - PrismaMfaAdapter — MfaPort against the SuperAdminMfa table.
//   - PrismaAuditAdapter — AuditPort against the AuditEntry table.
//   - AsyncLocalRlsBypassAdapter — RlsBypassPort via node:async_hooks.

export { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';
export { PrismaMfaAdapter } from './prisma-mfa.adapter.js';
export { PrismaAuditAdapter } from './prisma-audit.adapter.js';
export { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
