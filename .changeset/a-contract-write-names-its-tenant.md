---
'@saasicat/core': major
'@saasicat/nest': patch
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': major
---

Name the tenant when a contract is superseded or ended, so a wrong id cannot
reach another tenant's contract

`SubscriptionContractRepository.supersede` and `terminate` identified the
contract by id alone. On an installation with a row policy on
`subscription_contracts`, the policy was then the only thing keeping a wrong
id from ending another tenant's contract.

- `SupersedeSubscriptionContractData` and `TerminateSubscriptionContractData`
  carry `tenantId`, and both shipped adapters match it in the statement. The
  platform passes the tenant of the contract it read.
- `terminate` of a contract that no contract of that tenant carries is refused
  with `SUBSCRIPTION_CONTRACT_NOT_FOUND`, where Prisma failed with its own
  error and Drizzle with a plain one.
- `SubscriptionContractService.terminate` takes the tenant from the contract
  it reads rather than from the caller.
- The persistence contract supersedes and terminates under another tenant's
  id and expects nothing to change. A store of your own matches the tenant,
  and code that calls `supersede` or `terminate` on the port passes it.
