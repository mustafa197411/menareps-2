import { expect, test } from "@playwright/test";
import { desktopSidebar, isolatedRolePage } from "./browserSupport";
import { UAT_IDENTITIES } from "./roles";

test("browser contexts do not leak role authority", async ({ browser }) => {
  const admin = UAT_IDENTITIES.find(identity => identity.uid === "uat-admin")!;
  const representative = UAT_IDENTITIES.find(identity => identity.uid === "uat-medical-rep-west-a")!;
  const adminSession = await isolatedRolePage(browser, admin);
  await expect(desktopSidebar(adminSession.page).locator("#group-container-administration")).toBeVisible();
  await adminSession.context.close();

  const repSession = await isolatedRolePage(browser, representative);
  await expect(repSession.page.locator("#user-role-tag").first()).toHaveText(representative.role);
  await expect(desktopSidebar(repSession.page).locator("#group-container-administration")).toHaveCount(0);
  expect(repSession.remoteRequests).toEqual([]);
  await repSession.context.close();
});
