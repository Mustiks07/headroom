# Claude 3 — shared workspace, durable facts and useful evidence

Ветка `claude3`. Fetch + обычный merge `origin/main`, `npm ci`; прочитай AGENTS, [shared brief](ROUND3_SHARED.md), [integration review](../handoffs/integration-round2.md). Сохрани guest fallback, r3 upgrade и исправления JSON/action semantics интегратора.

## Первый deliverable — быстро разблокировать остальных

Отдельный маленький commit/push: `src/domain/household-workspace.ts` с Zod + types, `workspaceVersion: "2.0"`, fixture с двумя проектами и частичным SEP, typed integration result shapes/adapter signatures. Следовать семантике shared brief; не менять v1 контракт ломающе. `docs/handoffs/round3-contract.md` содержит точный SHA, exports, responsibilities и пример данных. Claude 1/2 берут этот commit, затем реализация идёт параллельно. Никаких success-stubs в пользовательском пути.

## Далее

1. **Довести атомарность сохранения.** Интегратор уже исправил `confirmPlanUpgrade`: после сохранённой revision и сбоя appendEvent возвращается saved + history warning, UI перечитывает новую revision. Сохрани это. Для нового workspace предпочтительна атомарная операция revision + event; иначе нужен безопасный retry только события с прежним id. Согласовать hook с Claude 1 через handoff, без параллельной перестройки PlanView.
2. **Workspace repository.** Browser local без ключей; optional anonymous Supabase, RLS, optimistic revision, история. Стабильные event IDs и idempotent retries. Сохранить различие local/cloud и конфликтов. A/B + actual payments + owner/year SEP переживают refresh, export/restore, ошибку сети.
3. **V1 migration.** Preview с происхождением baseline, старой opportunity/decision и неподтверждёнными выполнениями. Исходный SavedPlan/JSON хранится. Не конвертировать done checkbox или existingSep автоматически в платёж. Не удалять v1 до успешного v2 save. Unknown schema/newer export — понятное сообщение, не partial corrupt import.
4. **Импорт как подтверждение фактов.** Период, tax year, owner, source, YTD vs annual, expected vs received. CSV/TXT работает без provider. Повтор того же документа не удваивает запись; похожие суммы не достаточны для автоматического merge. Не классифицировать любую банковскую выручку как Schedule C profit. Сырой документ не попадает в logs/Git/analytics. Существующие quota/page/time limits остаются.
5. **Annual income forecast explanation.** Отдельный компактный English PDF: household/year/as-of, состав прогноза, confirmed facts vs estimates, управляемые проекты, принятые допущения, источники, missing information, engine/rules/fingerprint, даты актуальности. Подробности/trace можно приложением. Если нет полной книги транзакций, не называй это complete self-employment ledger. Нет обещания принятия HealthCare.gov и нет автоподачи. Старый подробный plan PDF сохранить.
6. **Deployment readiness.** Проверить env.example, SQL migration order, production build, отсутствие server secrets в client bundle, guest path при missing/misconfigured providers. Реальный Supabase/AI/Vercel smoke — только при наличии доступов, отсутствие доступа точно записать и завершить доступную часть. Не придумывать live URL, AI success или test payment.

## Границы и проверка

Твоя зона — shared domain, client/server/API, DB, exports, integration tests и config. Финансовые суммы из Claude 2; экранные компоненты и hooks подключения делает Claude 1. Не интегрировать все ветки в main самостоятельно: итоговый review делает Codex.

Проверки: partial save, repeated event/import, v1 migration/restore, two local revisions, real exported PDF, schema rejection. Если есть Supabase: два разных anonymous guest на реальной БД и RLS. Если нет, не выдавать mock за изоляцию production. Один typecheck, affected tests, build; PDF render и визуальный просмотр всех страниц. Без бесконечных тестов.

`docs/handoffs/claude3-round3.md`: schema SHA, hooks для Claude 1, migration/recovery, команды, реальные service status, PDF artifact. Commit + push `claude3`.
