import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type Browser } from "@playwright/test";
import { desktopSidebar, login } from "./browserSupport";
import { UAT_PROJECT_ID } from "./constants";
import { UAT_IDENTITIES } from "./roles";

const representative = UAT_IDENTITIES.find(identity => identity.uid === "uat-medical-rep-west-a");
if (!representative) throw new Error("[MENAREPS UAT] Synthetic Medical Representative is missing.");
const supervisor = UAT_IDENTITIES.find(identity => identity.uid === "uat-medical-supervisor");
if (!supervisor) throw new Error("[MENAREPS UAT] Synthetic Medical Supervisor is missing.");

async function representativePage(browser: Browser) {
  const context = await browser.newContext({
    geolocation: { latitude: 32.9, longitude: 13.1 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  await login(page, representative);
  return { context, page };
}

test("canonical Productivity permission controls My Workday navigation and governed check-in", async ({ browser }) => {
  test.setTimeout(90_000);
  const app = getApps().find(candidate => candidate.name === "wp92-attendance-navigation")
    ?? initializeApp({ projectId: UAT_PROJECT_ID }, "wp92-attendance-navigation");
  const permissionRef = getFirestore(app).collection("rolePermissions").doc(representative.role);

  try {
    await permissionRef.update({ view: true });
    const permitted = await representativePage(browser);
    const permittedSidebar = desktopSidebar(permitted.page);
    await expect(permittedSidebar.locator("#group-container-productivity")).toBeVisible();
    await permittedSidebar.locator("#group-container-productivity > button").click();
    await expect(permittedSidebar.locator("#nav-child-productivity-workday")).toBeVisible();
    await permitted.context.close();

    await permissionRef.update({ view: false });
    const denied = await representativePage(browser);
    await expect(desktopSidebar(denied.page).locator("#group-container-productivity")).toHaveCount(0);
    await denied.context.close();

    await permissionRef.update({ view: true });
    const attendance = await representativePage(browser);
    const sidebar = desktopSidebar(attendance.page);
    await sidebar.locator("#group-container-productivity > button").click();
    await sidebar.locator("#nav-child-productivity-workday").click();
    await expect(attendance.page.getByRole("heading", { name: "My Workday" })).toBeVisible();
    const checkIn = attendance.page.getByRole("button", { name: "Check In", exact: true });
    await expect(checkIn).toBeEnabled();
    await checkIn.click();
    await expect(attendance.page.getByText("On Duty", { exact: true })).toBeVisible();
    const checkOut = attendance.page.getByRole("button", { name: "Check Out", exact: true });
    await expect(checkOut).toBeEnabled();
    await checkOut.click();
    await expect(checkIn).toBeDisabled();
    await expect(checkOut).toBeDisabled();
    await attendance.context.close();

    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    await login(managerPage, supervisor);
    const managerSidebar = desktopSidebar(managerPage);
    await managerSidebar.locator("#group-container-supervision > button").click();
    await managerSidebar.locator("#nav-child-supervision-team-activity").click();
    await expect(managerPage.getByRole("heading", { name: "Field Team Activity Dashboard" })).toBeVisible();
    const subordinateRow = managerPage.locator("#team-activity-root table tr").filter({ hasText: "Synthetic Medical Representative" });
    await expect(subordinateRow).toBeVisible();
    await expect(subordinateRow).toContainText("Recorded");
    await managerContext.close();
  } finally {
    await permissionRef.update({ view: true });
    await deleteApp(app);
  }
});
