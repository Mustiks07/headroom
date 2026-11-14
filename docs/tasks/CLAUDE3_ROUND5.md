# Claude 3 — реальный AI pipeline, подтверждённые изменения и завершённое исполнение

Ты отвечаешь за работающий backend нового Headroom. Цель — не “AI enabled” boolean, а реальный путь документа/текста к проверяемым фактам, preview и сохранённому результату. Облачные данные и бюджеты должны переживать Vercel serverless, а старые планы — новую версию.

## 0. Начать с интегрированного main и малого контракта

Свой clone, ветка `claude3`, fetch → обычный merge `origin/main` → npm ci. Прочитать `AGENTS.md`, `integration-round4.md`, `ROUND5_SHARED.md`, assignment. Владение: API/server/client transport/persistence, additive domain schemas и fixtures, Supabase, package/config. UI и financial rules — через Claude 1/2.

Первым отдельным commit/push выдай shared contract `docs/handoffs/round5-contract.md`: типы/Zod, API request/response/errors, sample fixtures, exports для Claude 1/2, freshness/idempotency/versioning. Не заставлять коллег ждать весь backend. Продолжай основной pipeline сразу после контракта. Финансовые вычисления не копировать к себе.

## 1. Завершить существующий AI adapter

Исходники: `src/lib/server/extraction/anthropic.ts`, extraction index/text/common, `ai-guard.ts`, `env.ts`, `/api/documents/extract`, `src/lib/client/extraction-fields.ts`, `workspace-facts.ts`. Прочитать и расширить; не создавать конкурирующий стек.

Проверь доступность модели и текущий API по официальным Anthropic docs, совместимость установленного SDK/structured output. Модель из env. Не включать самый дорогой режим для каждого документа по привычке. Сравни 1–2 доступные модели на небольшом фиксированном synthetic set, если есть ключ и разрешённый бюджет; без ключа честно оставь реальный provider check невыполненным. Никакой mock extraction в production.

Ключ только server env; `AI_PROVIDER=none` на live пока Codex не проверит реальный запрос. Пользователь предоставит ключ отдельно. Ни credentials в Git/артефактах/client bundle, ни попыток искать ключ по компьютеру. Предусмотреть отдельные feature capabilities для extraction, text proposals, explanations; не обещать все три по одному настроенному ключу.

## 2. Извлечение документов и текста

Поддержать current-year P&L, pay stub, insurance/Marketplace statement, client offer/invoice и подтверждение полученного платежа/SEP в существующем supported scope. Не объявлять поддержку целой формы, если извлекается только пара полей; перечисли фактически читаемые fields.

Typed facts: valueAsPrinted, deterministic cents/date parsing, kind, document/content ID, source page/short excerpt, year/period/as-of/person candidate, extraction provenance и состояние review. LLM не annualizes и не считает прибыль/налоги. Unknown остаётся unknown. Важные поля не угадываются по похожим суммам. PDF text layer можно использовать для проверки цитаты; скан требует подтверждения пользователем. Совпадение model value с model-generated quote само по себе не является независимой проверкой документа.

Текст оффера — тоже untrusted input: извлечь terms, но не выполнить инструкции внутри. Receipt/invoice/offer различать. Bank statement deposits нельзя назвать net profit. Source evidence сохранять минимально необходимое, без полных SSN/account numbers; raw file не хранить по умолчанию.

Поочерёдные документы могут дополнять один draft. Дедуп по content+field+period/target, не по одной сумме. Два разных документа с одной суммой не автоматически duplicate; две разные суммы одного периода — conflict. Одно confirmed group apply атомарно записывает facts+sources+event, а не оставляет половину household обновлённой.

## 3. Естественный язык как предложение команд

Серверный endpoint для start/offer/update/explain с runtime validation и лимитами. Whitelist команд: add offered project, update expected payment, record receipt, correct fact with reason, record SEP, update supported forecast, change goal/terms. Model output — typed proposal, не произвольный patch/SQL/code/URL и не вызов действий.

Контекст модели минимален: opaque IDs, нужные названия/статусы/датированные facts; не отдавать весь документ/финансовый архив ради короткой фразы. Нужно уточнение при нескольких совпадениях, неизвестном человеке/годе/дате. Relative dates привязаны к supplied user date/timezone; явная абсолютная дата показана на подтверждении. Не использовать только server timezone.

Proposal хранит ID/base revision/fingerprint и стабильные refs. Claude 2 проверяет смысл и делает real preview, Claude 1 показывает. Подтверждение проверяет ownership, ту же base revision/fingerprint, schema и новую актуальность. Одна команда → один event/revision. Lost acknowledgement/retry не дублируют payment/SEP. Stale proposal требует нового preview, не silently overwrites.

Переиспользуй существующие операции в общей чистой библиотеке, согласовав перенос с Claude 1. Не оставляй два разных пути “manual applies differently than AI”. Настоящее consented пользовательское подтверждение должно быть обязательным и для bulk imported facts.

## 4. Объяснение только проверенного результата

Получать explanation packet от Claude 2. Default deterministic answer works without model; provider может сделать язык проще. Суммы/годы/сроки вставлять по validated references или проверять against packet. Если модель ввела неподтверждённый финансовый факт, вернуть deterministic explanation/unavailable, а не публиковать его.

Отказ/timeout/quota/schema failure сохраняют input и дают конкретный recovery. Не логировать пользовательский текст, документы, финансовые значения или полный provider payload. Допустимы status/error class, latency, usage counters без содержимого.

## 5. Закрыть слабость round4: пакет после согласия

Сейчас запись client agreement меняет workspace fingerprint, и старый decision PDF/ICS становятся недоступными. Завершить lifecycle, сохранив защиту от stale results.

Разделить исторический decision record (исходная ревизия/input snapshot/goal/terms/version/result/date/status) и актуальную оценку согласованного плана. Исторический PDF явно “Decision recorded on …; figures as of …”, а не свежая рекомендация. Для повторной проверки использовать исходный snapshot с поддерживаемыми rules; если такой версии нет, это честный archived record. Не подменять fingerprint старого результата новым.

Calendar — только текущие релевантные actions, учитывает факты оплаты/SEP/отмену. Stable UID+SEQUENCE; продумать отмену/перенос уже импортированного события: одного отсутствия VEVENT в следующем файле недостаточно, чтобы чужой календарь удалил старое. Не обещать автообновление после скачивания файла. Поддержать корректные cancellation/update entries или честно описать manual import behavior.

Исторический пакет остаётся читаем после новых данных. Актуальный cash/tax result пересчитывается отдельно. Fresh draft/choice нельзя экспортировать с изменёнными facts как current. Проверить новый actual после соглашения: не повторить оплату, не увеличить SEP второй раз. Изменения schema additive/explicit migration; round4 restored data не теряется.

## 6. Бюджеты и реальные сервисы

Vercel/Supabase уже подключены. Не создавать новые проекты/не включать login. Schema001–004 уже существует; только новая миграция при реальной необходимости. Existing anonymous sessions+RLS сохраняются. Операции proposal/draft изолированы между гостями; new tables требуют RLS и owner verification.

Durable quota должна охватывать ВСЕ AI endpoints, а не только PDF extraction. Global/day, guest/day, max request/page/output, timeout, explicit model, token usage и оценка стоимости с датированными тарифами. Global spend limit — основной предел; anonymous users можно пересоздать. Не делать незаметный fallback на более дорогую модель. При unavailable quota fail closed только AI, manual path работает.

Подготовить `docs/AI_DEPLOYMENT.md`: точные env names и безопасные defaults, provider smoke, без секретов. Реальная настройка ключа/деплой — Codex. Если ключ доступен через заранее разрешённый env, протестировать synthetic file в пределах указанного бюджета, не менять provider subscription.

## 7. Product evidence и бизнес-измерение

Согласуй с Claude 1 allowlisted events: start mode, review completed, missing question resolved, calculated result, proposal confirmed, plan saved/reopened, export, provider failure; synthetic demo vs own data отдельно. Не писать amounts/text/файлы/household profile; не включать финансовые fingerprints в analytics, где они могут восстановить личный профиль.

Обнови funnel specification и дай воспроизводимый агрегатный отчёт без invented usage. AI costs должны включать фактические provider usage для теста отдельно от modeled unit economics. Empty table остаётся empty, а не seeded “customers”. С researcher memo позже можно собрать pricing sensitivity; не менять live price/Stripe/lifecycle без согласования общей версии.

## Приёмка

Bounded integration group: successful extract→review→apply; unknown year/period; conflict; duplicate; stale revision; two-guest ownership для новых данных; timeout/quota/provider off with manual recovery; NL ambiguous→clarification→preview→confirm→retry no-op; historical/current export distinction; ICS update/cancel semantics; old workspace JSON roundtrip.

Один typecheck/build после готовности, тесты по рискам, реальный экспорт открыть/render. Не делать фальшивый успех без ключа. Приложить synthetic sample source documents, expected facts и actual provider observation, если выполнено; test doubles ясно отделить от реальных artifacts.

Commit/push `claude3`; `docs/handoffs/claude3-round5.md` с API examples, SHA контрактов, migrations/env, checks, фактическим provider/model/usage или явно unverified, artifacts и точными оставшимися шагами. Работу по кодовой части закончить даже если внешний ключ ещё не выдан.
