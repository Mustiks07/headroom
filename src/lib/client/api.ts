/**
 * Stable client adapter used by the UI (Claude 1). Import only from this module.
 *
 * Storage:   createPlanRepository(), getStorageMode(), clearLocalData(); CloudSaveFailedError → repo.saveLocally(plan)
 * Upgrade:   checkPlanCurrency(plan), previewPlanUpgrade(plan), confirmPlanUpgrade(repo, plan, preview, optionId)
 * Restore:   analyzePlanFile(text), planFromAnalysis(analysis, optionId)
 * Workspace: createWorkspaceRepository(), commitWorkspaceChange(), newWorkspaceEvent(), applyDocumentFact(),
 *            previewV1Migration(), confirmV1Migration(), analyzeWorkspaceFile(), exportWorkspaceJson(), exportForecastPdf()
 * Deals:     saveDealGoal(), saveCashContext(), saveActionPackage(), setPackageStatus(), setReminderStatus(), packageCurrency(),
 *            currentSearchFingerprint(), buildActionPackage(), buildClientDraft(), clientDraftNotes(), clientDraftFile(),
 *            buildCalendar(), exportCalendarIcs(), exportDecisionPdf(), previewDocumentFacts()
 * Assist:    toExtractedFacts(), mergeIntoDraft(), applyConfirmedFacts(), buildAssistanceContext(), proposeChange(), answerAmbiguity(),
 *            applyChangeProposal(), commitProposal(), applyCommand(), explainWorkspace() (server-recomputed), explainResult() (legacy), resolveDate(),
 *            lookupLocation(), lookupBenchmark() (insurance data), ensureOriginalOffer()
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
  getCapabilities, startCheckout, verifyCheckout, getLocalEntitlement, trackEvent, exportForecastPdf,
  exportDecisionPdf, exportCalendarIcs, clientDraftFile, proposeChange, intakeOffer, explainResult, explainWorkspace, lookupLocation, lookupBenchmark,
} from "./features";
export { toExtractedFacts, mergeIntoDraft, applyConfirmedFacts, emptyImportDraft } from "./import-draft";
export type { ExtractionResponse, FactDecision, GroupApplyResult } from "./import-draft";
export { buildAssistanceContext, proposeFromPatterns, answerAmbiguity, resolveDate, findAmountCents } from "./assistance-text";
export { applyCommand, applyChangeProposal, commitProposal, CommandError, ensureOriginalOffer, originalOfferFromLines } from "./workspace-commands";
export { saveDealGoal, saveCashContext, saveActionPackage, setPackageStatus, setReminderStatus, packageCurrency, currentSearchFingerprint, appendDecisionRecord, exportCurrentCalendar } from "./deal-state";
export { buildActionPackage, buildDecisionContext, buildClientDraft, clientDraftNotes, buildReminders, buildSpecialistNote, buildCalendar, reminderUid, termsAddUp,
  buildCurrentCalendar, currentPlanEvents, CALENDAR_IMPORT_NOTE } from "./deal-exports";
export {
  createWorkspaceRepository, createLocalWorkspaceRepository, commitWorkspaceChange, newWorkspaceEvent, WorkspaceConflictError,
} from "./workspace-repository";
export type { WorkspaceRepository, HybridWorkspaceRepository, WorkspaceSaveOutcome } from "./workspace-repository";
export { previewV1Migration, confirmV1Migration, analyzeWorkspaceFile, exportWorkspaceJson } from "./workspace-migration";
export type { V1MigrationPreview, V1MigrationAnswers, V1MigrationQuestion, ExistingSepAnswer, WorkspaceFileAnalysis } from "./workspace-migration";
export { applyDocumentFact, previewDocumentFacts } from "./workspace-facts";
export type { FactTarget, ApplyFactResult, FactPreview, FactOption, FactNeed } from "./workspace-facts";
export type { Capabilities, CheckoutResult } from "./features";
export { EXTRACTION_FIELDS, type ExtractionFieldPath, type ProposedFieldValue, type AmountPeriod } from "./extraction-fields";
export { ANALYTICS_EVENTS, type AnalyticsEvent } from "./analytics-events";
export { HeadroomError, PlanConflictError, PlanIntegrityError, StorageUnavailableError } from "./errors";
// Round 6: first-offer intake, onboarding draft, typed answers, lifecycle commands.
export { parseOfferText, questionsForOffers, loadOnboardingDraft, saveOnboardingDraft, clearOnboardingDraft, draftFromIntake, openQuestions, answerQuestion,
  offerCommand, onboardingToWorkspace, counterofferCommand, ONBOARDING_STORAGE_KEY } from "./offer-intake";
export { manualProposal, commitCommands, noteAcceptedTerms, CommandBlockedError } from "./workspace-commands";
