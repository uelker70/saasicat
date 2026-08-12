---
'@saasicat/nest': patch
---

Import the discovery primitives the coverage check depends on

`FeatureGuardCoverageCheck` injects Nest's `DiscoveryService` and
`MetadataScanner`, which exist only once `@nestjs/core`'s `DiscoveryModule` is
imported. It was registered without it, so any application reaching that branch
with the platform's own DiscoveryModule switched off failed to boot:
"Nest can't resolve dependencies of the FeatureGuardCoverageCheck".

Found by a consumer's test suite rather than ours, because the first test for
this check constructed the class directly and never went through DI. The module
test now asserts the import — by identity, since the platform ships a
`DiscoveryModule` of its own and a name comparison would assert nothing.
