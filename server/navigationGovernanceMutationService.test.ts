import { describe, expect, it } from "vitest";
import { Role } from "../src/types";
import { executeNavigationGovernanceMutation, NavigationGovernanceMutationError, parseNavigationGovernanceMutation } from "./navigationGovernanceMutationService";

function fakeDb(actor: Record<string, unknown>, existing: Record<string, unknown>) {
  let written: Record<string, unknown> | null = null;
  const governanceRef = { kind: "governance" };
  const db: any = {
    collection(name: string) { return { doc() { return name === "users" ? { get: async () => ({ exists: true, data: () => actor }) } : governanceRef; } }; },
    async runTransaction(callback: any) { await callback({ get: async () => ({ data: () => existing }), set: (_ref: any, value: any) => { written = value; } }); },
  };
  return { db, written: () => written };
}

describe("navigation governance backend mutation", () => {
  it("accepts only canonical hidden module/view arrays", () => {
    expect(parseNavigationGovernanceMutation({ operation: "SAVE", role: Role.MEDICAL_REP, restrictions: { hiddenModules: ["products"], hiddenViews: ["products-list"] } })).not.toBeNull();
    expect(parseNavigationGovernanceMutation({ operation: "SAVE", role: Role.MEDICAL_REP, restrictions: { hiddenModules: [], hiddenViews: ["arbitrary"] } })).toBeNull();
  });

  it("denies a non-administrator caller", async () => {
    const { db } = fakeDb({ role: Role.MEDICAL_REP, active: true }, {});
    await expect(executeNavigationGovernanceMutation("rep", { operation: "RESET", role: Role.MEDICAL_REP }, db)).rejects.toEqual(expect.objectContaining<Partial<NavigationGovernanceMutationError>>({ code: "NAVIGATION_GOVERNANCE_ROLE_DENIED", status: 403 }));
  });

  it("preserves unrelated governance fields on navigation-only save", async () => {
    const existing = { capabilities: [{ module: "VISITS", actions: { view: true } }], dataScopeMode: "DESCENDANTS", scopePolicy: { subjectMode: "DESCENDANTS" }, customFutureField: "preserve" };
    const state = fakeDb({ role: Role.ADMIN, active: true }, existing);
    await executeNavigationGovernanceMutation("admin", { operation: "SAVE", role: Role.MEDICAL_REP, restrictions: { hiddenModules: ["products"], hiddenViews: ["products-list"] } }, state.db);
    expect(state.written()).toMatchObject({ ...existing, role: Role.MEDICAL_REP, navigationRestrictions: { hiddenModules: ["products"], hiddenViews: ["products-list"] }, updatedBy: "admin" });
  });

  it("reset clears navigation restrictions without clearing capabilities or scope", async () => {
    const existing = { capabilities: [{ module: "VISITS" }], dataScopeMode: "SELF", navigationRestrictions: { hiddenModules: ["products"], hiddenViews: [] } };
    const state = fakeDb({ role: Role.SUPER_ADMIN, active: true }, existing);
    await executeNavigationGovernanceMutation("root", { operation: "RESET", role: Role.MEDICAL_REP }, state.db);
    expect(state.written()).toMatchObject({ capabilities: existing.capabilities, dataScopeMode: "SELF", navigationRestrictions: { hiddenModules: [], hiddenViews: [] } });
  });
});
