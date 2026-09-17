import { describe,expect,it } from "vitest";
import { Role } from "../types";
import { sidebarNavigationRegistryForRole } from "./sidebarNavigationRegistry";

describe("supervisor visit naming",()=>{
  it.each([Role.MEDICAL_SUPERVISOR,Role.SALES_SUPERVISOR])("labels Field Operations visits as Representative Visits for %s",role=>{
    const registry=sidebarNavigationRegistryForRole(role);
    const representative=registry.find(group=>group.id==="field-operations")?.children?.find(item=>item.id==="visits-review");
    const supervisor=registry.find(group=>group.id==="supervision")?.children?.find(item=>item.id==="supervision-visits");
    expect(representative?.label).toEqual({en:"Representative Visits",ar:"زيارات المندوبين"});
    expect(supervisor?.label).toEqual({en:"Supervisor Visits",ar:"زيارات المشرف الميدانية"});
  });
  it("preserves the generic label for non-supervisor roles",()=>expect(sidebarNavigationRegistryForRole(Role.MEDICAL_REP).find(group=>group.id==="field-operations")?.children?.find(item=>item.id==="visits-review")?.label.en).toBe("Visits"));
  it.each([Role.MEDICAL_SUPERVISOR,Role.SALES_SUPERVISOR])("registers separate planning, execution, and history surfaces for %s",role=>expect(sidebarNavigationRegistryForRole(role).find(group=>group.id==="supervision")?.children?.map(item=>item.id)).toEqual(expect.arrayContaining(["supervision-planning","supervision-field-visits","supervision-visits"])));
  it("keeps Coaching Reports independently registered",()=>expect(sidebarNavigationRegistryForRole(Role.MEDICAL_REP).find(group=>group.id==="supervision")?.children?.some(item=>item.id==="supervision-coaching-reports")).toBe(true));
});
