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
    check(await page.locator(".tile-rec button:has-text('Use this plan'):not([disabled])").count() === 0, "invalid price blocks 'Use this plan'");
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
    await page.locator(".tile-rec button:has-text('Use this plan')").click();
    await page.waitForURL(/\/plan\//, { timeout: 15000 });
    await page.waitForSelector(".plan-head");
    await page.reload(); await page.waitForSelector(".plan-head");
    check((await page.locator(".save-status").innerText()).includes("Revision 1"), "saved plan reopens after refresh (revision 1)");
    await page.getByRole("button", { name: "Something changed" }).click();
    await page.getByText("My income forecast changed").click();
    await page.locator("#f-years-0-incomes-0-scheduleCProfit").fill("121000");
    await page.getByRole("button", { name: "Recalculate" }).click();
    await page.waitForSelector(".change-review", { timeout: 15000 });
    check((await page.locator(".diff-list").innerText()).includes("$121,000"), "income change shows the before → after difference");
    check((await page.locator("section[aria-labelledby='agreed-impact-title']").innerText()).includes("now loses the 2026"), "saved payments are evaluated separately and expose the lost subsidy");
    await page.getByRole("button", { name: "Save the updated plan" }).click();
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("Revision 2"), null, { timeout: 10000 });
    check((await page.locator(".history").innerText()).includes("Income changed"), "plan saved as revision 2 with history entry");

    // 6. Missing spouse income: exact missing facts, linked to fields.
    await page.goto(`${base}/demo?case=missing-spouse-income`);
    await page.waitForSelector(".blocked", { timeout: 20000 });
    check(await page.getByRole("button", { name: "Add this" }).count() > 0, "missing-spouse demo lists the missing facts");

    // 7. Own data: an invalid amount survives a refresh and still blocks.
    await page.goto(`${base}/check`);
    await page.locator("#sec-B button.section-toggle").click();
    await page.locator("#f-years-0-incomes-0-scheduleCProfit").fill("12k");
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector("text=needs fixing", { timeout: 5000 }).catch(() => {});
    check(await page.locator("#f-years-0-incomes-0-scheduleCProfit").inputValue() === "12k", "restored draft keeps the invalid text instead of an old number");

    // 8. No whole-page horizontal scroll at 360 px.
    const mobile = await browser.newPage({ viewport: { width: 360, height: 780 } });
    for (const path of ["/", "/demo?case=family-cliff", "/check", "/plans", "/pricing"]) {
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
