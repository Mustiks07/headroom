# Claude 1 — implement selected C
**Selected:** cobalt/chrome/chartreuse C, explicitly chosen by the user. **Not selected:** the previous green/beige/serif direction. Read [spec.md](spec.md) and [tokens.json](tokens.json). No production files are changed by this handoff. Preserve the original C image and user final materials.

## Scope and order
Use the existing Next/React/CSS stack and current shared contracts. Follow the repository's installed Next guidance. No new UI framework, parallel importer, signup flow or financial calculation in components.

1. **Shell and typography:** `src/app/layout.tsx`, `src/app/globals.css`, `src/components/SiteChrome.tsx`. Add locally served licensed Geist Sans and the native mark. Replace old serif, cream and forest tokens coherently, including focus, errors, empty states and exports. Cobalt app header, predominantly light work surface. Preserve existing routes.
2. **Homepage:** `src/app/page.tsx`. Reproduce C's short centered headline, own chrome scene and overlapping white input tray. Keep heading, copy, form and CTA as live accessible DOM; the scene is a separate optimized asset with empty alt if purely decorative. Avoid adding tax-result numbers or fake proof to the marketing composition. Offer/documents/manual/example/current-year paths work from this entry.
3. **Review:** reuse `src/features/household/DocumentImport.tsx`, existing Workspace and round-5 extraction/readiness contracts. Build the light work area with source context, clear pending facts and one question when necessary. White surfaces can be arranged in two columns on desktop; avoid nested card grids.
4. **Comparison:** `src/features/deal/DealPanel.tsx`, `src/features/results/ComparisonView.tsx`, existing result components. One short finding and one selected outcome, up to three meaningful options, payment dates/conditions, evidence on demand. A selected result may be cobalt with white type; surrounding details stay white. Use lime for the strongest action only.
5. **Action and return:** `src/features/deal/ChooseTerms.tsx`, `src/features/household-plan/HouseholdPlanView.tsx` and related parts. Carry the same shell into draft/agreement/payment/update flows; do not stop at an attractive homepage and result screenshot.
6. **Responsive/states:** apply the same component rules to empty, pending, unsupported, ambiguous, stale, error and saved states. Concept images are included in this directory; implement functional states even if no image depicts each one.

## Behavior that must survive the redesign
**Offer-first start.** A pasted offer may be saved before household readiness. Ask only facts needed for that task. Current-year ACA check does not require a fictitious project or next-year forecast. Never discard already confirmed fields during a new import. Capability-gate PDF/image reading and natural-language actions; manual and available CSV/TXT paths remain usable when AI is off.

**Review.** Document/person/year/period/source and typed value remain inspectable. Extracted is not confirmed; invoice is not receipt. No default “Not yet”, zero spouse income or accepted agreement. Bulk confirmation applies only to coherent reviewed facts, with conflicts separate. Use a single meaningful group confirmation, not ten forced checkboxes. If completion is blocked, show the missing action beside the button. “I don't know” is valid and blocks only dependent results. Draft save does not confirm facts.

**Financial meaning.** The synthetic +$9,695 is project cash versus declining those terms after 2026 and 2027 tax settlements, with final settlement in 2028. It is neither today's bank cash nor savings created by Headroom. Bind labels to the actual baseline and horizon. If showing improvement over the original offer, use the authoritative engine field under matching facts/horizon; do not infer or invent that number. Keep retirement principal separate.

**Default policy comes from the engine and user constraints.** Do not transfer the image's selected “More cash overall” into code as a default recommendation. Price negotiability, money-by-date, available cash, retirement cap, uncertainty and recommendation reason determine presentation. The $33 SEP example is a fragile threshold case, not a safe plan. Keep review/sensitivity conditions visible on that option.

**Dates and agreement.** $14,000 and split receipts remain conditional on client agreement. Historical Nov 14, 2026 dates are a fixture snapshot, never hardcoded feasible future dates. Expected, agreed, received and completed are different states. Price bounds mean the complete price including any deposit. A paid deposit survives later term changes.

**Liquidity.** “By your date” and “After tax settlements” are distinct views on desktop and mobile. If household cash movements/reserves are missing, ask for them or show only known project receipts with their correct label. Never turn receipts into a household cash balance through copy.

**Execution.** Choosing → client draft/PDF/calendar → user records sharing/agreement → actual payments/contributions. Nothing is sent automatically. “Mark done” does not create a payment. Keep historical decision exports dated/versioned and separate from current assessment.

**Update.** “What changed?” uses the shared proposal API. Before/after preview, clarification if ambiguous, Apply/Edit/Cancel, then one persisted event/revision and recomputation. Preserve agreed obligations until explicitly revised. Repeated application cannot double-count a receipt.

## Mobile and interaction
At 360px use 20px gutters and a simple header. Work screens stack; keep 16px inputs/body and ≥14px essential explanation. Comparison becomes readable selection rows/sections, not a reduced desktop table. Source preview is an adjacent disclosure. Actions may stick only with safe-area padding and enough bottom content padding; focused controls must remain visible. Hero entry appears before the large decorative object on mobile.

Use consistent 44px minimum targets, 48px controls and visible two-surface focus treatment from the spec. Check radio keyboard behavior, error associations, drawer Escape/focus restoration and screen-reader announcements after Apply. Announce status, not every changing input. No hover-only essential controls. Pending computation cannot present the old recommendation as current.

Animation is brief feedback: 120/180/220ms, no countups. Scene is static by default or enters once; respect reduced motion. No artificial typing or pretend extraction stages. A successful save label only follows actual persistence; explain browser-only versus cloud save truthfully.

## Asset integration and performance
The five integration files listed in the spec are included in this directory. Preserve `01-home-selected.png` as the unchanged chosen reference. Do not use it as a background screenshot of the live website. Use the supplied transparent `05-hero-scene.png`; keep its aspect ratio, reserve dimensions to prevent layout shift, provide responsive sizes and an optimized web format without degrading the selected visual. No request to an image-generation service at runtime.

Use [headroom-mark.svg](headroom-mark.svg) inline for currentColor. When adjacent to wordmark text, hide the redundant symbol from assistive technology. The [logo proof](logo-proof.png) confirms small-size geometry in normal/inverse; it does not replace actual header/favicon inspection. Keep font license/copyright notices with served files.

## One bounded acceptance pass
After implementation, open the actual final build and complete one full synthetic route: start → source review → needed facts → calculation → feasible choice → draft/PDF/ICS → recorded agreement → receipt or contribution → change preview → apply → reload → historical/current export. Also check an ordinary positive offer, unknown spouse fact, ambiguous update and provider-off fallback. Inspect desktop and 360px; 200% zoom, keyboard and reduced motion; no horizontal overflow, hidden focus or misleading enabled controls.

Open the exported PDF pages and calendar content, not just the download success toast. Print/PDF stays readable on white with actual amounts, dates, baseline, assumptions and version. The chrome hero and heavy cobalt fill are not required in a financial report.

Run repository-required typecheck, affected smoke and build after completing the work; repeat only after relevant change/failure. Do not add style-only unit tests. Capture real final-build screenshots for the jury and replace no user-authored final material. Report implemented versus planned states and any concrete blocked contract, rather than using a mock as completion evidence.
