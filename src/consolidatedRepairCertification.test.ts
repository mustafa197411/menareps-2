import { describe, expect, it } from "vitest";
import { filterMaterialsForProduct, filterMaterialsForAuthorizedProducts } from "./lib/physicianVisitDetailingIntegrity";
import { duplicatePhysicianCandidates, parsePhysicianCreateRequest } from "../server/physicianCreateService";
import { authoritativeFirstVisitGpsUpdate, PhysicianVisitWriteError } from "../server/physicianVisitWriteService";
import { evaluateVisitMarketingExecute, nextVisitMarketingRequestStatus } from "./lib/visitMarketingRequestPolicy";

const resources = [
  { id:"SEL", resourceScope:"SELECTED_PRODUCTS", productIds:["PROD-2551"], active:true, uploadStatus:"COMPLETE", approvalStatus:"APPROVED" },
  { id:"PG", resourceScope:"PROMOTION_GROUP", promotionGroupId:"promotion2", productIds:[], active:true, uploadStatus:"COMPLETE", approvalStatus:"PUBLISHED", specialtyIds:["derm"] },
  { id:"OTHER", resourceScope:"SELECTED_PRODUCTS", productIds:["OTHER"], active:true, uploadStatus:"COMPLETE", approvalStatus:"APPROVED" },
  { id:"INACTIVE", resourceScope:"SELECTED_PRODUCTS", productIds:["PROD-2551"], active:false, uploadStatus:"COMPLETE", approvalStatus:"APPROVED" },
  { id:"DRAFT", resourceScope:"SELECTED_PRODUCTS", productIds:["PROD-2551"], active:true, uploadStatus:"COMPLETE", approvalStatus:"DRAFT" },
  { id:"PARTIAL", resourceScope:"SELECTED_PRODUCTS", productIds:["PROD-2551"], active:true, uploadStatus:"PROCESSING", approvalStatus:"APPROVED" },
  { id:"FUTURE", resourceScope:"SELECTED_PRODUCTS", productIds:["PROD-2551"], active:true, uploadStatus:"COMPLETE", approvalStatus:"APPROVED", effectiveDate:"2027-01-01" },
  { id:"EXPIRED", resourceScope:"SELECTED_PRODUCTS", productIds:["PROD-2551"], active:true, uploadStatus:"COMPLETE", approvalStatus:"APPROVED", expiryDate:"2025-01-01" },
] as any[];
const context = { productId:"PROD-2551", productPromotionGroupId:"promotion2", physicianSpecialtyId:"derm", today:"2026-08-26" };

describe("MENAREPS consolidated repair certification", () => {
  it("10-20 resolves exact Product and dynamic Promotion Group with lifecycle and specialty gates", () => {
    expect(filterMaterialsForProduct(resources, context).map(x=>x.id)).toEqual(["SEL","PG"]);
    expect(filterMaterialsForProduct(resources, { ...context, productId:"OTHER", productPromotionGroupId:"other" }).map(x=>x.id)).toEqual(["OTHER"]);
    expect(filterMaterialsForProduct(resources, { ...context, physicianSpecialtyId:"cardio" }).map(x=>x.id)).toEqual(["SEL"]);
    expect(filterMaterialsForAuthorizedProducts(resources, ["PROD-2551"], [{ id:"PROD-2551", promotionGroupId:"promotion2" }]).map(x=>x.id)).toContain("PG");
  });

  it("21-29 finds likely candidates without name-only or cross-Area blocking and validates commands", () => {
    const input:any={name:" Dr. Cosmótics ",areaId:"A1",specialty:"Dermatology",specialtyId:"derm",clinic:"Central",phone:"+218 91 1",email:"x@y.t",address:"a",countryId:"C",districtId:"D",cityId:"CT",classification:"B",territory:"C / D / CT / A",region:"D"};
    const rows:any[]=[{...input,id:"P1",name:"dr cosmotics"},{...input,id:"P2",areaId:"A2"},{...input,id:"P3",clinic:"Other",phone:"999",email:"z@y.t",specialtyId:"cardio"}];
    expect(duplicatePhysicianCandidates(input,rows).map(x=>x.id)).toEqual(["P1"]);
    expect(parsePhysicianCreateRequest({idempotencyKey:"same-command",physician:input})).not.toBeNull();
    expect(parsePhysicianCreateRequest({idempotencyKey:"",physician:input})).toBeNull();
  });

  it("30-42 creates only canonical first-verification fields and rejects invalid telemetry", () => {
    const visit:any={id:"V1",latitude:32.8,longitude:13.2,gpsVerified:true};
    expect(authoritativeFirstVisitGpsUpdate({physician:{gpsVerified:false},visit,actorUid:"REP",now:"2026-08-26T00:00:00Z"})).toMatchObject({gpsVerified:true,gpsVerificationStatus:"VERIFIED",gpsVerifiedByUid:"REP",gpsVerifiedVisitId:"V1"});
    expect(authoritativeFirstVisitGpsUpdate({physician:{gpsVerified:true},visit,actorUid:"REP",now:"x"})).toBeNull();
    expect(()=>authoritativeFirstVisitGpsUpdate({physician:{gpsVerified:false},visit:{...visit,latitude:999},actorUid:"REP",now:"x"})).toThrow(PhysicianVisitWriteError);
  });

  it("43-56 gives post-medical execution to a capable in-scope functional actor without ancestry", () => {
    const request:any={id:"R",status:"APPROVED",creatorUid:"REP",areaId:"A",supervisorReviewedByUid:"SUP",supervisorReviewedAt:"t1",finalReviewedByUid:"MM",finalReviewedAt:"t2"};
    const actor:any={id:"SMM",role:"Sales & Marketing Manager",active:true,loginAllowed:true};
    expect(evaluateVisitMarketingExecute({actorUid:"SMM",actor,request,actorAreaIds:["A"],permissions:{marketingRequestCapabilities:{execute:true}}})).toEqual({allowed:true,code:"AUTHORIZED"});
    expect(evaluateVisitMarketingExecute({actorUid:"SMM",actor,request:{...request,finalReviewedAt:undefined},actorAreaIds:["A"],permissions:{marketingRequestCapabilities:{execute:true}}}).code).toBe("INVALID_APPROVAL_STATE");
    expect(evaluateVisitMarketingExecute({actorUid:"SMM",actor,request,actorAreaIds:["B"],permissions:{marketingRequestCapabilities:{execute:true}}}).code).toBe("EXECUTE_FUNCTIONAL_SCOPE_DENIED");
    expect(evaluateVisitMarketingExecute({actorUid:"SMM",actor,request,actorAreaIds:["A"],permissions:{marketingRequestCapabilities:{execute:false}}}).code).toBe("EXECUTE_CAPABILITY_DENIED");
    expect(evaluateVisitMarketingExecute({actorUid:"REP",actor,request,actorAreaIds:["A"],permissions:{marketingRequestCapabilities:{execute:true}}}).code).toBe("SELF_EXECUTION_DENIED");
    expect(nextVisitMarketingRequestStatus("PENDING_FINAL_APPROVAL","EXECUTE")).toBeNull();
  });
});
