import { expect, test, type Browser, type Page } from "@playwright/test";
import { emulatorEmail, emulatorPassword, UAT_IDENTITIES, type UatIdentity } from "./roles";
import { UAT_BASE_URL } from "./constants";

const identity = (uid: string) => {
  const match = UAT_IDENTITIES.find(item => item.uid === uid);
  if (!match || UAT_IDENTITIES.filter(item => item.uid === uid).length !== 1) throw new Error(`Synthetic identity ${uid} is not unique.`);
  return match;
};

async function login(browser: Browser, actor: UatIdentity) {
  const context = await browser.newContext(); const page = await context.newPage(); await page.goto(UAT_BASE_URL);
  await page.locator("#cloud-auth-toggle-badge").click(); await page.locator('input[type="email"]').fill(emulatorEmail(actor)); await page.locator('input[type="password"]').fill(emulatorPassword(actor)); await page.getByRole("button", { name: "Secure Login" }).click();
  await page.locator('[data-session-state="INITIALIZING"]').waitFor({ state: "visible" });
  const terminal = page.locator('[data-session-state="OPERATIONAL"], [data-session-state="NON_OPERATIONAL"], [data-session-state="ERROR"]'); await terminal.waitFor({ state: "visible" });
  expect(await terminal.getAttribute("data-session-state")).toBe("OPERATIONAL");
  return { context, page };
}

async function navigate(page: Page, groupId: string, childId: string) {
  const group = page.locator(`#split-layout > #sidebar-container #sidebar-navigation #group-container-${groupId}`); await expect(group).toBeVisible();
  const child = group.locator(`#nav-child-${childId}`); if (await child.count() === 0) await group.getByRole("button").click(); await expect(child).toBeVisible(); await child.click();
}

test("governed Pharmacy Visit creates the canonical Finance-queue Order", async ({ browser }) => {
  test.setTimeout(120_000);
  const representative = await login(browser, identity("uat-sales-rep-west-a"));
  await navigate(representative.page, "pharmacies", "pharmacies-pharmacy-visit");
  await representative.page.getByText("Synthetic In-Scope Pharmacy", { exact: true }).click();
  const visitPurposeSection = representative.page.locator("#section-visit-purpose");
  const primaryVisitPurpose = visitPurposeSection
    .getByText("Primary Visit Purpose *", { exact: true })
    .locator("..").locator("..").getByRole("combobox");
  await primaryVisitPurpose.selectOption("REGULAR_COMMERCIAL_VISIT");
  await representative.page.getByRole("button", { name: "Proceed to Order Items (Step 2)" }).click();
  const productCard = representative.page.getByText("Synthetic Product A", { exact: true }).locator("..").locator("..");
  await productCard.getByRole("button", { name: "Add to Order" }).click();
  await representative.page.getByRole("button", { name: "Proceed to Step 3 (Offers)" }).click();
  await representative.page.getByRole("button", { name: "Proceed to Step 4 (Payment Terms)" }).click();
  await representative.page.getByRole("button", { name: "Proceed to Step 5 (Stock & Notes)" }).click();
  await representative.page.getByRole("button", { name: "Proceed to Step 6 (Complete Visit)" }).click();
  await representative.page.getByRole("button", { name: "Complete Visit" }).click();
  const orderConfirmation = representative.page.getByText(/Order No\. UT-SO-/);
  await expect(orderConfirmation).toBeVisible();
  const orderNumber = (await orderConfirmation.textContent())?.match(/UT-SO-[A-Z0-9-]+/)?.[0];
  expect(orderNumber).toBeTruthy();
  await representative.context.close();

  const finance = await login(browser, identity("uat-finance-officer"));
  await navigate(finance.page, "sales-and-orders", "sales-orders");
  const canonicalOrderRow = finance.page.getByRole("row").filter({ hasText: orderNumber! });
  await expect(canonicalOrderRow.getByText("Synthetic In-Scope Pharmacy", { exact: true })).toBeVisible();
  await expect(canonicalOrderRow.getByText("Pending Financial Review", { exact: true })).toBeVisible();
  await canonicalOrderRow.getByTitle("View Details").click();
  await finance.page.getByRole("button", { name: "Finance Approve & Clear" }).click();
  await finance.page.getByRole("button", { name: "Apply Finance Decision" }).click();
  await expect(finance.page.getByText("Finance approval completed", { exact: true })).toBeVisible();
  await expect(finance.page.getByText("Pending Operations Review", { exact: true })).toBeVisible();
  await finance.context.close();

  const operations = await login(browser, identity("uat-order-operations-officer"));
  await navigate(operations.page, "operations", "operations-order-operations");
  const operationsRow = operations.page.getByRole("row").filter({ hasText: orderNumber! });
  await expect(operationsRow.getByText("Synthetic In-Scope Pharmacy", { exact: true })).toBeVisible();
  await operationsRow.getByRole("button", { name: "Review" }).click();
  const operationsDetailHeader = operations.page.getByText("Order detail", { exact: true }).locator("..").locator("..");
  await expect(operationsDetailHeader.getByText("Pending Operations Review", { exact: true })).toBeVisible();
  await operations.page.getByRole("button", { name: "Submit Operations Decision" }).click();
  await expect(operations.page.getByText("Transition completed; queue reloaded.", { exact: true })).toBeVisible();
  await operations.context.close();

  const store = await login(browser, identity("uat-store-manager"));
  await navigate(store.page, "operations", "operations-order-operations");
  const storeRow = store.page.getByRole("row").filter({ hasText: orderNumber! });
  await expect(storeRow.getByText("Synthetic In-Scope Pharmacy", { exact: true })).toBeVisible();
  await storeRow.getByTitle("View Details").click();
  await expect(store.page.getByRole("heading", { name: "Inline Store Manager Decision Panel" })).toBeVisible();
  await store.page.getByRole("button", { name: "Complete Store Preparation" }).click();
  const deliveryOfficerSelect = store.page.getByRole("combobox").filter({
    has: store.page.getByRole("option", { name: "Synthetic Delivery Officer", exact: true }),
  });
  await deliveryOfficerSelect.selectOption({ label: "Synthetic Delivery Officer" });
  await store.page.getByText("Planned Delivery Date", { exact: true }).locator("..").locator("input").fill("2026-08-22");
  await store.page.getByRole("button", { name: "Apply Store Decision" }).click();
  await expect(store.page.getByText("Store Preparation Complete", { exact: true })).toBeVisible();
  await store.context.close();

  const delivery = await login(browser, identity("uat-delivery-officer"));
  await navigate(delivery.page, "operations", "operations-order-operations");
  const deliveryRow = delivery.page.getByRole("row").filter({ hasText: orderNumber! });
  await expect(deliveryRow.getByText("Synthetic In-Scope Pharmacy", { exact: true })).toBeVisible();
  await deliveryRow.getByTitle("View Details").click();
  await expect(delivery.page.getByText("Enterprise Decision Workspace", { exact: true })).toBeVisible();
  await delivery.page.getByRole("button", { name: "Delivered Successfully" }).click();
  await delivery.page.getByPlaceholder("Full name of receiving person...").fill("Synthetic Pharmacy Recipient");
  await delivery.page.getByRole("button", { name: "Apply Delivery Decision" }).click();
  await expect(delivery.page.getByText("Delivery Decision Applied", { exact: true })).toBeVisible();
  await expect(delivery.page.getByRole("heading", { name: `View Order: ${orderNumber}` })).toBeVisible();
  await expect(delivery.page.getByText("Delivered", { exact: true })).toBeVisible();
  await expect(delivery.page.getByText("Delivered / Closed", { exact: true })).toBeVisible();
  await delivery.page.getByRole("button", { name: "Return to Delivery Queue" }).click();
  await delivery.page.getByRole("button", { name: "6. Closed/History" }).click();
  const completedRows = delivery.page.getByRole("row").filter({ hasText: orderNumber! });
  await expect(completedRows).toHaveCount(1);
  await expect(completedRows.getByText("Delivered", { exact: true })).toBeVisible();
  await delivery.context.close();
});
