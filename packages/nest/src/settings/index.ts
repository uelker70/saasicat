// The record of the applied configuration: what the installation runs on,
// since when, from where — and what changed between two starts.

export { AppliedSettingsRecorder, type BootOutcome } from './applied-settings.recorder.js';
export {
    buildSettingsController,
    type AppliedSettingsView,
    type SettingsChangeView,
} from './settings.controller.js';
export { SettingsModule, type SettingsModuleOptions } from './settings.module.js';
export { fingerprintOf } from './settings-fingerprint.js';
export { APPLIED_SETTINGS_PORT_TOKEN, SETTINGS_SOURCE_TOKEN } from './settings.tokens.js';
