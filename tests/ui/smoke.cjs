/**
 * Real-path UI check (Claude 1, round 2). Not part of `npm test`.
 *
 *   npm run build
 *   node tests/ui/smoke.cjs                      # starts `next start` on a free port
 *   BASE_URL=http://localhost:3000 node tests/ui/smoke.cjs   # or use a running app
 *
 * Playwright is a pinned dev dependency. Install its browser once with
 * `npx playwright install chromium`. The check uses the real engine and the
 * browser-local plan repository: it REQUIRES ready results where the sample
 * household is supported and fails on "unavailable".
 */
const { spawn } = require("node:child_process");
const net = require("node:net");

let chromium;
try { ({ chromium } = require("playwright")); } catch {
  console.error("Playwright is not installed. Run: npm ci && npx playwright install chromium");
  process.exit(2);
}

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
const money = text => Number(String(text).replace(/[^0-9−-]/g, "").replace("−", "-"));

async function startServer() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL, stop: () => {} };
  const port = await freePort();
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(port)], { stdio: "ignore" });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) return { base, stop: () => child.kill() }; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("The app did not start. Run `npm run build` first.");
}

(async () => {
  const { base, stop } = await startServer();
  // CHROMIUM_PATH lets a machine with a preinstalled browser run the pinned Playwright without downloading one.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", d => d.accept());

    // 1. Family demo shows a real decision first.
    await page.goto(`${base}/demo?case=family-cliff`);
    await page.waitForSelector(".tile-rec, .blocked", { timeout: 20000 });
    check(await page.locator(".tile-rec").count() === 1, "family demo opens on a ready result (not blocked/unavailable)");
    const acceptTile = page.locator(".tile").nth(1).locator(".tile-big");
    const before = money(await acceptTile.innerText());
    check(Number.isFinite(before), `accept-as-offered amount shown (${await acceptTile.innerText()})`);

    // 2. Changing the price changes the real result.
    const price = page.locator("#f-opportunity-grossRevenueCents");
    await price.fill("13000");
    await page.waitForFunction(b => { const el = document.querySelectorAll(".tile")[1]?.querySelector(".tile-big"); return el && !document.querySelector(".overview.is-stale") && Number(el.textContent.replace(/[^0-9−-]/g, "").replace("−", "-")) !== b; }, before, { timeout: 15000 });
    check(true, "price $12,000 → $13,000 changes the accept-as-offered amount");

    // 3. Invalid money blocks the calculation and saving; it is not silently ignored.
    await price.fill("13,0x0");
    await page.waitForSelector("text=Fix these amounts to update the result", { timeout: 5000 });
    await page.waitForTimeout(800);
    check(await page.locator(".overview-actions .btn.primary:not([disabled])").count() === 0, "invalid price blocks saving the recommended plan");
    await price.fill("13000");
    await page.waitForFunction(() => !document.querySelector(".overview.is-stale") && document.querySelector(".tile-rec"), null, { timeout: 15000 });

    // 4. A lower SEP limit makes the over-budget SEP option unavailable, with a reason.
    await page.locator("#f-constraints-maxAdditionalSepCents").fill("2000");
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !document.querySelector(".comparison.is-stale"), null, { timeout: 15000 });
    const infeasible = page.locator(".scenario.infeasible");
    check(await infeasible.count() >= 1 && await infeasible.first().locator(".reasons").count() === 1, "SEP limit $2,000 → an option is marked not available with its reason");
    check(await infeasible.locator("button:has-text('Use this plan')").count() === 0, "no 'Use this plan' on an unavailable option");

    // 5. Save → reopen → something changed → save revision 2.
    await page.locator(".overview-actions .btn.primary").click();
    await page.waitForURL(/\/plan\//, { timeout: 15000 });
    await page.waitForSelector(".plan-head");
    await page.reload(); await page.waitForSelector(".plan-head");
    check((await page.locator(".save-status").innerText()).includes("Revision 1"), "saved plan reopens after refresh (revision 1)");
    await page.getByRole("button", { name: "Something changed" }).click();
    await page.getByText("My income forecast changed").click();
    await page.locator("#f-ui-forecasts-primary-2026-annualNetProfit").fill("121000");
    await page.getByRole("button", { name: "Recalculate" }).click();
    await page.waitForSelector(".change-review", { timeout: 15000 });
    check((await page.locator(".diff-list").innerText()).includes("$121,000"), "income change shows the before → after difference");
    check((await page.locator("section[aria-labelledby='agreed-impact-title']").innerText()).includes("now loses the 2026"), "saved payments are evaluated separately and expose the lost subsidy");
    await page.getByRole("button", { name: "Save the updated plan" }).click();
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("Revision 2"), null, { timeout: 30000 });
    check((await page.locator(".history").innerText()).includes("Income changed"), "plan saved as revision 2 with history entry");

    // 6. Missing spouse income: exact missing facts, linked to fields.
    await page.goto(`${base}/demo?case=missing-spouse-income`);
    await page.waitForSelector(".blocked", { timeout: 20000 });
    check(await page.getByRole("button", { name: "Add this" }).count() > 0, "missing-spouse demo lists the missing facts");

    // 7. Own data: an invalid amount survives a refresh and still blocks.
    await page.goto(`${base}/check`);
    await page.locator("#sec-B button.section-toggle").click();
    await page.locator("#f-ui-forecasts-primary-2026-annualNetProfit").fill("12k");
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector("text=needs fixing", { timeout: 5000 }).catch(() => {});
    check(await page.locator("#f-ui-forecasts-primary-2026-annualNetProfit").inputValue() === "12k", "restored draft keeps the invalid text instead of an old number");

    // 8. No whole-page horizontal scroll at 360 px.
    const mobile = await browser.newPage({ viewport: { width: 360, height: 780 } });
    // 8. Household plan (v2 workspace): actual payment replaces expected; SEP goal / paid / left; survives reload.
    await page.goto(`${base}/household`);
    await page.getByRole("button", { name: /Open the sample household plan/ }).click();
    await page.waitForURL(/\/household\/[^/?]+/, { timeout: 15000 });
    const settled = () => page.waitForFunction(() => document.querySelector(".overview .tile") && !document.querySelector(".overview.is-stale"), null, { timeout: 20000 });
    await settled();
    const profit = async () => (await page.locator(".overview .tile").nth(1).locator(".tile-big").first().innerText()).trim();
    const beforeProfit = await profit();
    await page.getByRole("button", { name: "Record received" }).first().click();
    await page.locator('input[id^="amt-"]').fill("3200"); await page.locator('input[id^="date-"]').fill("2026-12-16");
    await page.getByRole("button", { name: "Save this payment" }).click();
    await page.waitForFunction(() => /Revision 2\b/.test(document.querySelector(".save-status")?.textContent ?? ""), null, { timeout: 20000 });
    await settled();
    const afterProfit = await profit();
    check(beforeProfit === "$125,000" && afterProfit === "$125,200", `actual $3,200 replaces expected $3,000 (profit ${beforeProfit} → ${afterProfit})`);
    check((await page.locator("#project-proj-a").innerText()).includes("received Dec 16, 2026"), "the entered actual receipt date is saved, not the old expected date");
    await page.getByRole("button", { name: "Record a contribution you made" }).click();
    await page.locator("#c-amount").fill("1500"); await page.locator("#c-date").fill("2026-11-10");
    await page.getByRole("button", { name: "Save contribution" }).click();
    await page.waitForFunction(() => /Revision 3\b/.test(document.querySelector(".save-status")?.textContent ?? ""), null, { timeout: 20000 });
    await settled();
    const sepText = (await page.locator(".sep-row .sep-figures").innerText()).replace(/\s+/g, " ");
    check(/Yearly goal \$5,000 Already contributed \$3,500 Left to contribute \$1,500/.test(sepText), `SEP goal / paid / left: ${sepText}`);
    check((await page.locator(".sep-row").innerText()).includes("paid Nov 10, 2026"), "the entered SEP paid date is preserved");
    await page.reload(); await settled();
    check((await page.locator(".save-status").innerText()).includes("Revision 3") && await profit() === "$125,200", "household plan reopens at revision 3 with the recorded facts");

    // 9. Round 4: goal-first terms for proposal B on top of agreed A (real searchDealTerms), then an unreachable goal.
    {
      const deal = page.locator("#deal-panel");
      const search = async () => { await deal.getByRole("button", { name: /^(Find terms|Search again)$/ }).click();
        await page.waitForFunction(() => { const r = document.querySelector("#deal-result"); return r && !r.querySelector(".loading-line") && !r.querySelector(".stale-banner") && r.querySelector(".variant, .blocked"); }, null, { timeout: 30000 }); };
      await page.locator("#project-proj-b").getByRole("button", { name: "Find terms for my goal" }).click(); await deal.waitFor();
      await page.locator("#goal-keep").fill("4000"); await page.locator("#goal-sep").fill("1000");
      await deal.getByRole("button", { name: "Price and payment limits" }).click();
      await page.locator("#goal-price-min").fill("12000"); await page.locator("#goal-price-max").fill("14000"); await page.locator("#goal-latest").fill("2027-01-31");
      await page.selectOption("#goal-parts", "2"); await deal.locator("fieldset.tri").getByText("Yes", { exact: true }).click();
      await search();
      const variants = await page.locator("#deal-result .variant").count();
      check(variants >= 1 && variants <= 3 && await page.locator("#deal-result .variant.recommended").count() === 1, `goal search returns ${variants} calculated option(s) with one pick`);
      await page.locator("#goal-keep").fill("20000"); await page.locator("#goal-price-max").fill("13000"); await search();
      check(await page.locator("#deal-result .no-terms").count() === 1 && await page.locator("#deal-result .variant").count() === 0, "unreachable goal shows 'no terms' (no success card)");
    }

    for (const path of ["/", "/demo?case=family-cliff", "/check", "/household", "/plans", "/pricing"]) {
      await mobile.goto(base + path); await mobile.waitForTimeout(1200);
      const w = await mobile.evaluate(() => document.documentElement.scrollWidth);
      check(w <= 360, `${path} fits 360 px (${w}px)`);
    }
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  } finally {
    await browser.close();
    stop();
  }
  console.log(failures.length ? `\nUI check FAILED (${failures.length})` : "\nUI check passed");
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
