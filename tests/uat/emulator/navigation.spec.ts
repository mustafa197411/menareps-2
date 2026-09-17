import { expect, test } from "@playwright/test";
import { desktopSidebar, isolatedRolePage } from "./browserSupport";
import { UAT_IDENTITIES } from "./roles";

test.describe("24-role browser navigation", () => {
  for (const identity of UAT_IDENTITIES) {
    test(`${identity.role} receives isolated governed navigation`, async ({ browser }) => {
      const { context, page, remoteRequests } = await isolatedRolePage(browser, identity);
      const sidebar = desktopSidebar(page);
      await expect(sidebar).toBeVisible();
      await page.reload();
      await expect(page.locator("#user-role-tag").first()).toHaveText(identity.role, { timeout: 30_000 });
      expect(remoteRequests).toEqual([]);
      await context.close();
    });
  }
});
