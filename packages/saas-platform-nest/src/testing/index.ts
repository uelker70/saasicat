// @saasicat/nest/testing — test utilities.
//
// Fake adapters for the repository ports + TransactionRunner. For unit tests
// in the platform package and in consumers without a DB requirement.

export * from './fake-repositories.js';
export * from './create-saas-platform-test-module.js';
