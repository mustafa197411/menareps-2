import { expect, test, type Browser, type Page } from "@playwright/test";
import { emulatorEmail, emulatorPassword, UAT_IDENTITIES, type UatIdentity } from "./roles";
import { UAT_BASE_URL } from "./constants";

const byUid = (uid: string): UatIdentity => {
  const matches = UAT_IDENTITIES.filter(identity => identity.uid === uid);
  if (matches.length !== 1) throw new Error(`[MENAREPS UAT] Expected exactly one synthetic identity for ${uid}.`);
  const match = matches.find(identity => identity.uid === uid);
  if (!match) throw new Error(`[MENAREPS UAT] Synthetic identity ${uid} did not resolve.`);
  return match;
};

const representative = byUid("uat-medical-rep-west-a");
const supervisor = byUid("uat-medical-supervisor");
const finalManager = byUid("uat-medical-manager");
const executionManager = byUid("uat-country-manager-ly");
const requestDescription = "Synthetic governed visit support request";

async function loginAs(browser: Browser, identity: UatIdentity) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(UAT_BASE_URL);
  await page.locator("#cloud-auth-toggle-badge").click();
  await page.locator('input[type="email"]').fill(emulatorEmail(identity));
  await page.locator('input[type="password"]').fill(emulatorPassword(identity));
  await page.getByRole("button", { name: "Secure Login" }).click();
  await page.locator('[data-session-state="INITIALIZING"]').waitFor({ state: "visible" });
  const terminal = page.locator('[data-session-state="OPERATIONAL"], [data-session-state="NON_OPERATIONAL"], [data-session-state="ERROR"]');
  await terminal.waitFor({ state: "visible" });
  const state = await terminal.getAttribute("data-session-state");
  if (state === "NON_OPERATIONAL") {
    throw new Error(`[MENAREPS UAT] Session ended non-operational: ${await terminal.getAttribute("data-readiness-status")} (${await terminal.getAttribute("data-readiness-reason")})`);
  }
  if (state === "ERROR") {
    throw new Error(`[MENAREPS UAT] Session initialization failed: ${await terminal.getAttribute("data-initialization-error")}`);
  }
  await expect(page.locator("#split-layout > #sidebar-container #user-role-tag")).toHaveText(identity.role);
  return { context, page };
}

async function openNavigation(page: Page, groupId: string, childId: string) {
  const sidebar = page.locator("#split-layout > #sidebar-container #sidebar-navigation");
  const group = sidebar.locator(`#group-container-${groupId}`);
  await expect(group).toBeVisible();
  const child = group.locator(`#nav-child-${childId}`);
  if (await child.count() === 0) await group.getByRole("button").click();
  await expect(child).toBeVisible();
  await child.click();
}

function fieldByLabel(container: ReturnType<Page["locator"]>, label: string, element: "select" | "input" | "textarea") {
  return container.getByText(label, { exact: true }).locator("..").locator(element);
}

async function requestCard(page: Page) {
  const card = page.locator('[data-testid^="visit-marketing-request-card-"]').filter({ hasText: requestDescription });
  await expect(card).toHaveCount(1);
  const testId = await card.getAttribute("data-testid");
  if (!testId) throw new Error("[MENAREPS UAT] Canonical request card has no semantic identity.");
  return { card, requestId: testId.replace("visit-marketing-request-card-", "") };
}

test("canonical Medical workflow completes through governed browser actions", async ({ browser }) => {
  test.setTimeout(120_000);

  const repSession = await loginAs(browser, representative);
  const repPage = repSession.page;

  await openNavigation(repPage, "field-operations", "field-medical-planner");
  await expect(repPage.locator("#medical-planner-module")).toBeVisible();
  await expect(repPage.locator("#medical-planner-module").getByRole("heading", { name: /^Dr\. Synthetic In-Scope Physician$/ })).toBeVisible();
  await expect(repPage.getByText("Synthetic Out-of-Scope Physician", { exact: true })).toHaveCount(0);

  await openNavigation(repPage, "field-operations", "field-physician-visit");
  await expect(repPage.locator("#physician-visit-wrapper")).toBeVisible();
  await expect(repPage.locator("#unplanned-physicians-list").getByText("Synthetic Out-of-Scope Physician", { exact: true })).toHaveCount(0);
  await repPage.locator("#unplanned-physicians-list").getByText("Synthetic In-Scope Physician", { exact: true }).click();
  await expect(repPage.locator("#gps-success-banner")).toBeVisible();
  await repPage.locator("#btn-start-visit").click();

  const detailing = repPage.locator('#detailing-blocks-list > [id^="detailing-block-"]');
  await expect(detailing).toHaveCount(1);
  await detailing.locator("#products-selection-grid").getByText("Synthetic Product A", { exact: true }).click();
  await expect(detailing.locator("#messages-pills").getByText("Synthetic canonical primary message", { exact: true })).toBeVisible();
  await detailing.locator("#messages-pills").getByText("Synthetic canonical primary message", { exact: true }).click();
  await fieldByLabel(detailing.locator("#det-reaction-notes"), "Physician Reaction", "select").selectOption("Positive");
  await fieldByLabel(detailing.locator("#det-reaction-notes"), "Prescription Intent", "select").selectOption("Will Prescribe");
  await repPage.locator("#step2-navigation").getByRole("button", { name: /Samples/ }).click();

  const sample = repPage.locator('#sample-blocks-list > [id^="sample-block-"]');
  await expect(sample).toHaveCount(1);
  await fieldByLabel(sample, "Sample Product", "select").selectOption("P-A");
  await fieldByLabel(sample, "Sample SKU", "select").selectOption("SKU-P-A-ONE");
  await fieldByLabel(sample, "Quantity", "input").fill("3");
  await repPage.locator("#step3-navigation").getByRole("button", { name: /Outcomes/ }).click();

  await repPage.locator("#marketing-header-row").getByRole("button", { name: /Add Request/ }).click();
  const marketingRequest = repPage.locator('#mr-requests-container > [id^="mr-block-"]');
  await expect(marketingRequest).toHaveCount(1);
  const plannedDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await fieldByLabel(marketingRequest, "Planned Date", "input").fill(plannedDate);
  await fieldByLabel(marketingRequest, "Description", "textarea").fill(requestDescription);
  await repPage.locator("#btn-complete-physician-visit").click();
  await expect(repPage.locator("#step-1-content")).toBeVisible();
  await repSession.context.close();

  const supervisorSession = await loginAs(browser, supervisor);
  await openNavigation(supervisorSession.page, "marketing", "marketing-my-requests");
  const supervisorRequest = await requestCard(supervisorSession.page);
  await expect(supervisorRequest.card.locator(`[data-testid="visit-marketing-request-status-${supervisorRequest.requestId}"]`)).toHaveText("PENDING_SUPERVISOR");
  await supervisorRequest.card.locator(`[data-testid="visit-marketing-request-supervisor-approve-${supervisorRequest.requestId}"]`).click();
  await expect(supervisorRequest.card.locator(`[data-testid="visit-marketing-request-status-${supervisorRequest.requestId}"]`)).toHaveText("PENDING_FINAL_APPROVAL");
  await supervisorSession.context.close();

  const finalSession = await loginAs(browser, finalManager);
  await openNavigation(finalSession.page, "marketing", "marketing-my-requests");
  const finalRequest = await requestCard(finalSession.page);
  await finalRequest.card.locator(`[data-testid="visit-marketing-request-final-approve-${finalRequest.requestId}"]`).click();
  await expect(finalRequest.card.locator(`[data-testid="visit-marketing-request-status-${finalRequest.requestId}"]`)).toHaveText("APPROVED");
  await finalSession.context.close();

  const executionSession = await loginAs(browser, executionManager);
  await openNavigation(executionSession.page, "marketing", "marketing-my-requests");
  const executionRequest = await requestCard(executionSession.page);
  await executionRequest.card.locator(`[data-testid="visit-marketing-request-execute-${executionRequest.requestId}"]`).click();
  await executionRequest.card.locator(`[data-testid="visit-marketing-request-action-input-${executionRequest.requestId}"]`).fill("Synthetic support completed");
  await executionRequest.card.locator(`[data-testid="visit-marketing-request-action-confirm-${executionRequest.requestId}"]`).click();
  await expect(executionRequest.card.locator(`[data-testid="visit-marketing-request-status-${executionRequest.requestId}"]`)).toHaveText("EXECUTED");
  await expect(executionRequest.card.locator(`[data-testid="visit-marketing-request-execution-note-${executionRequest.requestId}"]`)).toHaveText("Synthetic support completed");
  await executionSession.context.close();

  const historySession = await loginAs(browser, representative);
  await openNavigation(historySession.page, "field-operations", "field-physician-visit");
  await historySession.page.locator("#unplanned-physicians-list").getByText("Synthetic In-Scope Physician", { exact: true }).click();
  await expect(historySession.page.locator("#previous-visit-details")).toContainText("Synthetic Product A");
  await expect(historySession.page.locator("#previous-visit-details")).toContainText("Synthetic Sample Unit");
  await historySession.context.close();
});
