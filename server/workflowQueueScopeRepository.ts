import { getFirebaseAdminServices } from "./firebaseAdmin";

export interface WorkflowQueueActor {
  id: string;
  role?: string;
  active?: boolean;
  loginAllowed?: boolean;
  isDeleted?: boolean;
  status?: string;
  employmentStatus?: string;
  accountStatus?: string;
  securityScope?: string;
  country?: string;
  assignedCountries?: string[];
}

export interface WorkflowGeographyRecord {
  id: string;
  name?: string;
  code?: string;
  countryId?: string;
  districtId?: string;
  cityId?: string;
  active?: boolean;
  status?: string;
}

export interface WorkflowGeographyCatalog {
  countries: WorkflowGeographyRecord[];
  districts: WorkflowGeographyRecord[];
  cities: WorkflowGeographyRecord[];
  areas: WorkflowGeographyRecord[];
}

export interface WorkflowQueueScopeRepository {
  getActor(uid: string): Promise<WorkflowQueueActor | null>;
  getGeographyCatalog(): Promise<WorkflowGeographyCatalog>;
}

function documents(snapshot: any): WorkflowGeographyRecord[] {
  return snapshot.docs.map((document: any) => ({ ...document.data(), id: document.id }));
}

export function createFirestoreWorkflowQueueScopeRepository(): WorkflowQueueScopeRepository {
  const db = getFirebaseAdminServices().db;
  return {
    async getActor(uid) {
      const snapshot = await db.collection("users").doc(uid).get();
      return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    },
    async getGeographyCatalog() {
      const [countries, districts, cities, areas] = await Promise.all([
        db.collection("countries").get(),
        db.collection("districts").get(),
        db.collection("cities").get(),
        db.collection("areas").get(),
      ]);
      return {
        countries: documents(countries),
        districts: documents(districts),
        cities: documents(cities),
        areas: documents(areas),
      };
    },
  };
}
