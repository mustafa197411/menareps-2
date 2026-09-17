import { expect, test } from "@playwright/test";
import { desktopSidebar, isolatedRolePage } from "./browserSupport";
import { UAT_IDENTITIES } from "./roles";

for (const uid of ["uat-super-admin", "uat-admin"]) {
  test(`${uid} can reach governed Administration settings`, async ({ browser }) => {
    const identity = UAT_IDENTITIES.find(item => item.uid === uid)!;
    const { context, page, remoteRequests } = await isolatedRolePage(browser, identity);
    const sidebar = desktopSidebar(page);
    await sidebar.locator("#group-container-administration > button").click();
    for (const viewId of ["admin-role-settings", "admin-location", "admin-order-workflow-settings"]) {
      await expect(sidebar.locator(`#nav-child-${viewId}`)).toBeVisible();
    }
    expect(remoteRequests).toEqual([]);
    await context.close();
  });
}

test("representative sees My Workday but not Administration settings", async ({ browser }) => {
  const identity = UAT_IDENTITIES.find(item => item.uid === "uat-medical-rep-west-a")!;
  const { context, page, remoteRequests } = await isolatedRolePage(browser, identity);
  const sidebar = desktopSidebar(page);
  await sidebar.locator("#group-container-productivity > button").click();
  await expect(sidebar.locator("#nav-child-productivity-workday")).toBeVisible();
  await expect(sidebar.locator("#group-container-administration")).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
  await context.close();
});
