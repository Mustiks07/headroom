# Claude 2 — меньше вопросов, надёжные изменения и объяснимое решение

Ты отвечаешь за то, чтобы Headroom действительно понимал, каких данных достаточно, правильно оценивал изменения и давал полезный результат. ИИ убирает ввод, но не заменяет финансовые правила. Сделай детерминированную основу для нового UX, а не ещё одну большую таблицу налогов.

## Старт и владение

В своём clone/ветке `claude2`: fetch, обычный merge свежего `origin/main`, npm ci. Прочитать `AGENTS.md`, `integration-round4.md`, `ROUND5_SHARED.md`, своё задание и engine specs. Не потерять исправления интегратора: total price incl. deposit, повтор agreement без повторного SEP, актуальность package, даты новых платежей, SEP cash snapshot.

Твои пути: `src/lib/engine/**`, `data/rules/**`, `data/reference/**`, `reference/**`, `scripts/reference/**`, `tests/engine/**`. Нужные новые общие типы сначала согласовать с Claude 3, взять его отдельный SHA. Не вводить второй financial engine или дублирующий UI readiness heuristic.

## 1. Readiness по намерению человека

Реализовать публичный pure API, согласованный контрактом, например `assessInputReadiness(draft, intent)`. Намерения: current-year subsidy; оценка нового заказа; поиск условий на два года; пересмотр согласованного плана. Возвращать готовность, конкретные недостающие факты, причину каждого, typed answer, удобный path/sourceRef и unsupported reasons.

Никакой зависимости текущего года от 2027/ненужного opportunity. Не запрашивать поля, которые не влияют на выбранную поддерживаемую ситуацию. Но нельзя “упростить” выкидыванием spouse wages, eligibility, household size, premiums или других реально необходимых факторов. Неизвестное явно unknown. Нулевой доход допустим только как подтверждённый ответ.

Разделить: без данных вообще; диапазон с полезным устойчивым выводом; диапазон меняет решение; точный supported result. Если имеющаяся uncertainty модель не доказывает неизменность решения, не называй его устойчивым. Вопрос “что узнать первым” приоритетизировать реальным влиянием на возможность расчёта/выбор, не выдуманной оценкой вероятности.

Контракт выдаёт короткий question set; UI Claude 1 определяет вид, но не переписывает правила. Разница между “не можем посчитать пока” и “не поддерживаем этот случай” должна сохраниться.

## 2. Семантика документов и сверка фактов

Дай общие deterministic validators/cross-checks для импортированных фактов: человек, налоговый год, monthly/YTD/annual/one-time, as-of date, gross/net, expected/received, basis confirmed/estimated/unknown. Распознанное AI число ещё не подтверждённый факт пользователя.

P&L net profit through date + remaining receipts − remaining expenses; annual amount нельзя получить автоматическим умножением YTD. Прошлогодний Schedule C полезен как источник прошлого года, а не подтверждённый текущий forecast. Invoice amount не является deposit received. APTC, enrollment premium и benchmark — разные поля. Coverage months не растягиваются автоматически.

Банковские переводы/заём/возврат/личное пополнение не становятся revenue. Уже включённые managed payments не добавляются к прибыли второй раз. Аналогично оплаченный SEP не превращается в новую доступную сумму. Дубликат документа/операции — no-op, конфликт — needs_resolution, не выбор последнего значения.

Если вид документа/структура вне scope, сохранение источника и явный missing fact допустимы; не увеличивать поддержку налоговых форм без реальных правил и проверки. Отдельно укажи Claude 3, какие metadata нельзя выводить из совпадения суммы.

## 3. Preview изменений от естественного языка

LLM предлагает whitelisted typed commands, Claude 3 хранит/применяет. Твоя часть: валидировать бизнес-смысл и рассчитать `ChangePreview` на копии workspace. Изменения не применяются до подтверждения пользователя.

Обязательные типы: добавить proposal по офферу; изменить ожидаемую сумму/дату; записать полученный платёж; исправить ошибочный факт с причиной; добавить SEP contribution; обновить annual/YTD forecast; поменять goal/allowed terms. Дата оплаты в прошлом допустима как запись уже случившегося факта, но не как предложение задним числом. Relative “today/next Friday” разрешается с явной датой/reference timezone пользователя и показывается на подтверждении.

До/после: текущая ACA позиция и settlement при достаточных данных, cash effect относительно явно названной базы, agreed terms re-evaluation, stale package/action dependencies. Не сравнивать с новым оптимумом, когда вопрос — “держатся ли уже согласованные условия”. Только после этого показывать новые варианты по запросу.

В preview изменять только выбранные строки, сохранять received facts/expenses/историю. Ambiguous project/person/year возвращает уточнение. Операция никогда не “исправляет” unknown на0 ради возможности посчитать.

## 4. Надёжность вариантов и запас

Проверить actual selection policy на живых scenarios. Сейчас самый простой вариант может сохранить credit при дополнительном SEP всего $33 и запасе дохода $1. Математически это допустимо, но пользователь должен видеть хрупкость решения. Предлагай отдельный вариант с большим запасом только если он реально найден в заданных cash/price/date пределах; показывай цену такого запаса.

Проверка чувствительности: реальные пороги, действительный диапазон, какие assumptions меняют результат. Никаких вероятностей/“safe” без доказательства. Сложный вариант ради нескольких долларов не должен вытеснять почти равноценный простой; materiality policy остаётся документированной. Если к прошлому search есть реальные дефекты, исправить с маленьким counterexample regression.

Проверить consistency датированного cash и двухлетнего итога, reserves/settlement ровно один раз, untouched reserve и completeness. Сценарий balance goal должен включать перечисленные крупные движения, а при неполных данных возвращать null/partial, не “goal met”. Отдельно внимательно проверить снимки на день полученного платежа: included IDs должны управлять двойным учётом, а не молчаливое предположение о времени.

Не заменять lattice search “глобальным оптимумом” в тексте. Explain no-feasible: что действительно проверено, какое ослабление одного ограничения помогает при остальных неизменных. В UI нельзя назвать найденную оценку абсолютным максимумом, если между шагами результат не доказан.

## 5. Объяснение результата без галлюцинаций

Сформировать машиночитаемый explanation packet из existing results: baseline, horizon, receipts/expenses/tax/credit/SEP attribution, source/rule IDs, missing assumptions, sensitivities и next action. Каждая отображаемая сумма имеет путь к результату. Claude 3 может переформулировать язык, но не вводить новые числа/советы.

На вопросы “Why am I worse off?”, “Why January?”, “What if the client refuses?”, “What would change your answer?” дать supported answer либо точный unresolved fact. Default explanation можно строить шаблоном без provider. Отдельно gross price vs incremental cash vs retirement. Не называть разницу с declining “savings caused by Headroom”.

Для исторического decision package Claude 3: согласовать как хранить исходный input snapshot и проверять старый расчёт на тех же versioned rules. Исторический snapshot не надо переоптимизировать на новых фактах и выдавать за тот же выбор. Если старый ruleset не доступен, экспорт только честного записанного архива, без falsely reverified label.

## 6. Evidence для продукта и жюри

Сделать 3 понятных воспроизводимых сценария: cliff deal с альтернативами; ordinary positive; неопределённость, переворачивающая ответ. Дополнительный обязательный сценарий: аванс уже получен → новые условия только остатка → fact update. Для каждого input → output → practical action → limitations; synthetic labels.

Сохранить числовые доказательства и сравнение с текущим engine, но не CPA certification. Обновить `docs/ENGINE_SPEC.md` и handoff только в изменившейся части. Если исследователь даст competitive claim, проверить его конкретным сценарием; не объявлять бесплатный конкурент хуже из-за того, что ему ввели другие premiums/MAGI.

## Проверка и сдача

Дополнительная явная область владения в этом раунде: `scripts/business/**` и `docs/research/round5-unit-economics.md`. После получения research memo проверь его арифметику воспроизводимым небольшим скриптом: pay-per-decision / season / annual, price, payment fees, AI cost по usage, support/refunds, repeat usage/renewal, CAC ceiling, contribution margin, payback. Все неизвестные входы — видимые assumptions, три сценария и sensitivity; не выдавать modelled LTV за cohort evidence. CAC рекламного канала = CPC/(visitor-to-qualified * qualified-to-paid), а не CPC. Annual LTV не выводить из придуманного monthly churn. Выход — таблица и точные формулы для презентации, не customer-facing финансовая рекомендация. Исследователь поставляет sources; не дублируй весь market search и не жди его, чтобы закончить core engine.

Ограниченный набор: readiness single-year без next year; missing spouse; annual/YTD conflict; received/deposit invariants; stale/duplicate command; SEP funding; одна граница, меняющая выбор; partial/full cash context; ordinary-positive. Добавлять regression только для найденных ошибок, не сотни тестов на диапазон.

Typecheck, relevant tests, один build. Commit/push `claude2`, handoff `docs/handoffs/claude2-round5.md`: exports/signatures, dependencies SHA, реальные outputs, правила округления/uncertainty, known limitations, что должен показать UI, что нужно backend. Не заканчивать на contract-only/types/stub.
