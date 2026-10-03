import { expect, test, type Browser, type Page } from "@playwright/test";

const CODES = { scout: "e2e-scout", manager: "e2e-manager", strategist: "e2e-strategist", lead: "e2e-lead" };

async function signIn(browser: Browser, name: string, role: keyof typeof CODES, viewport = { width: 390, height: 844 }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto("/hub/");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Code").fill(CODES[role]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".shell")).toBeVisible();
  return page;
}

async function fillAndSubmit(page: Page) {
  await page.getByRole("radio", { name: "Over the bump" }).click();
  await page.getByRole("button", { name: "Add 1 to Scoring cycles" }).click();
  await page.getByRole("button", { name: "Add 10 to Fuel scored", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Level reached" }).getByRole("radio", { name: "Level 2" }).click();
  await page.getByRole("radiogroup", { name: "Scoring" }).getByRole("radio", { name: "Good" }).click();
  await page.getByRole("radiogroup", { name: "Defence" }).getByRole("radio", { name: "No evidence" }).click();
  await page.getByRole("button", { name: "Submit entry" }).click();
}

test("a wrong code is refused", async ({ page }) => {
  await page.goto("/hub/");
  await page.getByLabel("Your name").fill("Nobody");
  await page.getByLabel("Code").fill("guess");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("That code is not right");
});

test("scouts are given different robots, and the manager watches an entry being written and submitted", async ({ browser }) => {
  const ada = await signIn(browser, "Ada Lovelace", "scout");
  const bo = await signIn(browser, "Bo Diddley", "scout");
  const manager = await signIn(browser, "Jordi Vila", "manager", { width: 1280, height: 900 });

  await expect(ada.locator(".placard-team")).toBeVisible();
  await expect(bo.locator(".placard-team")).toBeVisible();
  const adaRobot = await ada.locator(".placard-team").innerText();
  const boRobot = await bo.locator(".placard-team").innerText();
  expect(adaRobot).not.toBe(boRobot);

  // The manager's roster lists both scouts as online.
  await manager.getByRole("link", { name: "Scouts", exact: true }).click();
  await expect(manager.locator("tr", { hasText: "Ada Lovelace" })).toContainText("Online");
  await expect(manager.locator("tr", { hasText: "Bo Diddley" })).toContainText("Online");
  await manager.getByRole("link", { name: "Live board" }).click();

  // Ada opens the form and starts typing: the board shows her writing.
  await ada.getByRole("button", { name: "Start scouting" }).click();
  await ada.getByRole("button", { name: "Add 1 to Scoring cycles" }).click();
  // Once she has opened the form the slot is hers and shows her name in bold.
  const slot = manager.locator(".slot", { has: manager.locator("strong", { hasText: "Ada Lovelace" }) }).first();
  await expect(slot).toContainText("Writing");

  // She submits: the board shows it and her own page says so.
  await fillAndSubmit(ada);
  await expect(slot).toContainText("Submitted");
  await expect(ada.getByRole("button", { name: "Submitted. Open to change" })).toBeVisible();

  // The manager can open the entry and see who wrote it.
  await manager.getByRole("link", { name: "Entries" }).click();
  await expect(manager.locator("table")).toContainText("Ada Lovelace");

  // Sam closes his phone; the manager's roster shows him offline.
  await bo.context().close();
  await manager.getByRole("link", { name: "Scouts", exact: true }).click();
  await expect(manager.locator("tr", { hasText: "Bo Diddley" })).toContainText("Offline", { timeout: 20_000 });
});

test("an entry made without signal is kept on the phone and sent once when it returns", async ({ browser }) => {
  const scout = await signIn(browser, "Cy Young", "scout");
  await scout.getByRole("button", { name: "Start scouting" }).click();
  await expect(scout.locator(".entry-head")).toBeVisible();
  await scout.context().setOffline(true);
  await fillAndSubmit(scout);
  await expect(scout.getByRole("status").filter({ hasText: "waiting to send" })).toBeVisible();

  let sent = 0;
  scout.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/entries/")) sent += 1;
  });
  // Back in range: it sends by itself, with no button to press.
  await scout.context().setOffline(false);
  await expect(scout.getByText("waiting to send")).toHaveCount(0, { timeout: 20_000 });
  await expect(scout.locator(".entry-row", { hasText: "Sent" }).first()).toBeVisible();
  expect(sent).toBe(1);
});

test("strategists see compiled data; scouts and managers cannot", async ({ browser }) => {
  const strategist = await signIn(browser, "Alex Strategist", "strategist", { width: 1280, height: 900 });
  await expect(strategist.getByRole("heading", { name: "Strategy" })).toBeVisible();
  await strategist.getByRole("link", { name: "Teams", exact: true }).click();
  await expect(strategist.locator(".teams-table tbody tr").first()).toBeVisible();
  await strategist.locator(".teams-table tbody tr").first().click();
  await expect(strategist.getByText("Points a match")).toBeVisible();
  await strategist.goto("/hub/strategy/matches");
  await expect(strategist.getByRole("heading", { name: "Red alliance" })).toBeVisible();
  await expect(strategist.locator(".planner-field")).toBeVisible();
  await strategist.goto("/hub/picks");
  await expect(strategist.getByRole("heading", { name: "Pick list" })).toBeVisible();

  for (const role of ["scout", "manager"] as const) {
    const page = await signIn(browser, `${role} outsider`, role);
    await expect(page.getByRole("link", { name: "Strategy" })).toHaveCount(0);
    await page.goto("/hub/strategy");
    await expect(page.getByText("Your sign-in code does not open this page.")).toBeVisible();
    const response = await page.request.get("/api/hub/events/2026demo/analysis/teams");
    expect(response.status()).toBe(403);
    const picks = await page.request.get("/api/hub/events/2026demo/picks");
    expect(picks.status()).toBe(403);
  }
});

test("admin is a separate page from the scout manager, for leads only", async ({ browser }) => {
  const manager = await signIn(browser, "Jordi Vila", "manager", { width: 1280, height: 900 });
  await expect(manager.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await manager.goto("/hub/admin");
  await expect(manager.getByText("Your sign-in code does not open this page.")).toBeVisible();

  const lead = await signIn(browser, "Casey Lead", "lead", { width: 1280, height: 900 });
  await lead.goto("/hub/admin");
  await expect(lead.getByRole("heading", { name: "Set up an event" })).toBeVisible();
  await lead.goto("/hub/manager");
  await expect(lead.getByRole("heading", { name: "Scout manager" })).toBeVisible();
});

test("the original strategy page still loads", async ({ page }) => {
  const response = await page.goto("/strategy");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Griffins 1884 Strategy");
});

test("one scout's unsent entry is not sent or shown under another scout's name on a shared phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const signInAs = async (name: string) => {
    await page.goto("/hub/");
    await page.getByLabel("Your name").fill(name);
    await page.getByLabel("Code").fill(CODES.scout);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".shell")).toBeVisible();
  };

  await signInAs("Dee First");
  await page.getByRole("button", { name: "Start scouting" }).click();
  await expect(page.locator(".entry-head")).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add 1 to Scoring cycles" }).click();
  await expect(page.locator(".entry-save")).toContainText("Saved on this phone");

  // The phone is handed over with no signal, then comes back into range.
  await page.evaluate(() => {
    document.cookie = "hub_session=; Max-Age=0; path=/";
    localStorage.removeItem("hub-session");
  });
  await context.setOffline(false);
  await context.clearCookies();
  await signInAs("Eve Second");
  await expect(page.getByText("waiting to send")).toHaveCount(0);
  await expect(page.getByText("Not submitted yet")).toHaveCount(0);

  const manager = await signIn(browser, "Jordi Vila", "manager", { width: 1280, height: 900 });
  const response = await manager.request.get("/api/hub/events/2026demo/manager/entries?scout=eve%20second");
  expect((await response.json()).entries).toHaveLength(0);
});
