/**
 * Stable client adapter used by the UI (Claude 1). Import only from this module.
 *
 * Storage:   createPlanRepository(), getStorageMode(), clearLocalData(); CloudSaveFailedError → repo.saveLocally(plan)
 * Upgrade:   checkPlanCurrency(plan), previewPlanUpgrade(plan), confirmPlanUpgrade(repo, plan, preview, optionId)
 * Restore:   analyzePlanFile(text), planFromAnalysis(analysis, optionId)
 * Documents: extractDocument(file, { consentToProvider }), EXTRACTION_FIELDS
 * Export:    exportPlanPdf(plan), exportPlanJson(plan), exportCaseJson(input)
 * Service:   getCapabilities(), startCheckout(), verifyCheckout(), getLocalEntitlement(), trackEvent()
 * Errors:    PlanConflictError, PlanIntegrityError, StorageUnavailableError, HeadroomError
 */
export { createPlanRepository, getStorageMode, clearLocalData, CloudSaveFailedError, PartialClearError } from "./repository";
export type { HeadroomPlanRepository, StorageMode, StorageModeInfo, PlanLocation } from "./repository";
export { checkPlanCurrency, previewPlanUpgrade, confirmPlanUpgrade, CURRENT_VERSIONS } from "./plan-upgrade";
export type { PlanCurrency, PlanUpgradePreview, FigureChange, VersionPair } from "./plan-upgrade";
export { analyzePlanFile, planFromAnalysis } from "./plan-restore";
export type { RestoreAnalysis } from "./plan-restore";
export { subscribeToLocalPlanChanges } from "./local-repository";
export {
  extractDocument, exportPlanPdf, exportPlanJson, exportCaseJson, readCaseInputFromJson,
  getCapabilities, startCheckout, verifyCheckout, getLocalEntitlement, trackEvent,
} from "./features";
export type { Capabilities, CheckoutResult } from "./features";
export { EXTRACTION_FIELDS, type ExtractionFieldPath, type ProposedFieldValue, type AmountPeriod } from "./extraction-fields";
export { ANALYTICS_EVENTS, type AnalyticsEvent } from "./analytics-events";
export { HeadroomError, PlanConflictError, PlanIntegrityError, StorageUnavailableError } from "./errors";
