/**
 * Small UI smoke flow (Claude 1). Not part of `npm test`.
 * Run against a started app:  BASE_URL=http://localhost:3000 node tests/ui/smoke.cjs
 * Works before and after engine/storage integration: it accepts a real result
 * or a truthful blocked/unavailable state, never a crash or a blank page.
 */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const fail = msg => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));

  await page.goto(BASE);
  if (!(await page.getByRole("link", { name: /Check my subsidy/ }).first().isVisible())) fail("primary CTA missing");
  if (await page.getByText(/sign in|log in|sign up|password/i).count()) fail("login/signup copy found");

  for (const id of ["family-cliff", "ordinary-gig", "missing-spouse-income"]) {
    await page.goto(`${BASE}/demo?case=${id}`);
    await page.waitForSelector(".scenario, .blocked, .risk-card", { timeout: 15000 }).catch(() => fail(`${id}: no result or state shown`));
    console.log(id, "→", (await page.locator(".scenario").count()) ? "scenarios" : (await page.locator(".blocked h3").first().innerText().catch(() => "risk only")));
  }

  await page.goto(`${BASE}/check`);
  await page.getByRole("button", { name: "Check my subsidy" }).first().click();
  await page.getByRole("button", { name: "Add this" }).first().click();
  await page.waitForTimeout(300);
  if (await page.evaluate(() => document.activeElement?.id) !== "f-state") fail("missing-field link did not focus the state field");

  const mobile = await browser.newPage({ viewport: { width: 360, height: 780 } });
  for (const path of ["/", "/check", "/demo?case=family-cliff", "/plans", "/pricing"]) {
    await mobile.goto(BASE + path);
    await mobile.waitForTimeout(400);
    const w = await mobile.evaluate(() => document.documentElement.scrollWidth);
    if (w > 360) fail(`${path} scrolls horizontally at 360px (${w}px)`);
  }
  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
  await browser.close();
  console.log(process.exitCode ? "UI smoke: FAILED" : "UI smoke: passed");
})();
