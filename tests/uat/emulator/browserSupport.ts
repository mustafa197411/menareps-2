import { expect, type Browser, type Page } from "@playwright/test";
import type { UatIdentity } from "./roles";
import { emulatorEmail, emulatorPassword } from "./roles";
import { UAT_BASE_URL } from "./constants";

export async function login(page: Page, identity: UatIdentity): Promise<void> {
  await page.goto(UAT_BASE_URL);
  await page.locator("#cloud-auth-toggle-badge").click();
  await page.locator('input[type="email"]').fill(emulatorEmail(identity));
  await page.locator('input[type="password"]').fill(emulatorPassword(identity));
  await page.getByRole("button", { name: "Secure Login" }).click();
  await expect(page.locator("#user-role-tag").first()).toHaveText(identity.role, { timeout: 30_000 });
}

export async function isolatedRolePage(browser: Browser, identity: UatIdentity) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const remoteRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    const permittedStaticHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
    if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname) && !permittedStaticHosts.has(url.hostname)) remoteRequests.push(url.origin);
  });
  await login(page, identity);
  return { context, page, remoteRequests };
}

export function desktopSidebar(page: Page) {
  return page.locator("#split-layout > #sidebar-container").locator("#sidebar-navigation");
}
