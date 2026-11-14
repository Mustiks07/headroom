/**
 * Stable client adapter used by the UI (Claude 1). Import only from this module.
 *
 * Storage:   createPlanRepository(), getStorageMode(), clearLocalData()
 * Documents: extractDocument(file, { consentToProvider }), EXTRACTION_FIELDS
 * Export:    exportPlanPdf(plan), exportPlanJson(plan), exportCaseJson(input), importPlanJson(file)
 * Service:   getCapabilities(), startCheckout(), verifyCheckout(), getLocalEntitlement(), trackEvent()
 * Errors:    PlanConflictError, PlanIntegrityError, StorageUnavailableError, HeadroomError
 */
export { createPlanRepository, getStorageMode, clearLocalData } from "./repository";
export type { HeadroomPlanRepository, StorageMode, StorageModeInfo } from "./repository";
export { subscribeToLocalPlanChanges } from "./local-repository";
export {
  extractDocument, exportPlanPdf, exportPlanJson, exportCaseJson, importPlanJson, readCaseInputFromJson,
  getCapabilities, startCheckout, verifyCheckout, getLocalEntitlement, trackEvent,
} from "./features";
export type { Capabilities, CheckoutResult } from "./features";
export { EXTRACTION_FIELDS, type ExtractionFieldPath, type ProposedFieldValue, type AmountPeriod } from "./extraction-fields";
export { ANALYTICS_EVENTS, type AnalyticsEvent } from "./analytics-events";
export { HeadroomError, PlanConflictError, PlanIntegrityError, StorageUnavailableError } from "./errors";
