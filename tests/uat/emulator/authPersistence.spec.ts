import { expect, test } from "@playwright/test";
import { isolatedRolePage } from "./browserSupport";
import { UAT_IDENTITIES } from "./roles";

test("authenticated role survives refresh without cross-user state", async ({ browser }) => {
  const admin = UAT_IDENTITIES.find(identity => identity.uid === "uat-admin")!;
  const { context, page, remoteRequests } = await isolatedRolePage(browser, admin);
  await page.reload();
  await expect(page.locator("#user-role-tag").first()).toHaveText(admin.role, { timeout: 30_000 });
  expect(remoteRequests).toEqual([]);
  await context.close();
});
