import { collection, getDocs, onSnapshot, query, where, type DocumentData, type Firestore, type QueryDocumentSnapshot } from "firebase/firestore";
import type { SampleDataScope } from "../types";

const FIRESTORE_IN_LIMIT = 30;

export function chunkSampleSubjectIds(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += FIRESTORE_IN_LIMIT) chunks.push(unique.slice(index, index + FIRESTORE_IN_LIMIT));
  return chunks;
}

export async function fetchScopedSampleCollection(database: Firestore, collectionName: string, scope: SampleDataScope, authorizedIds: readonly string[]) {
  const chunks = scope === "ORG" ? [null] : chunkSampleSubjectIds(authorizedIds);
  const snapshots = await Promise.all(chunks.map(ids => getDocs(ids === null ? collection(database, collectionName) : ids.length === 1
    ? query(collection(database, collectionName), where("repId", "==", ids[0]))
    : query(collection(database, collectionName), where("repId", "in", ids)))));
  const merged = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  snapshots.forEach(snapshot => snapshot.docs.forEach(row => merged.set(row.id, row)));
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Subscribes to every authorized subject chunk and emits one de-duplicated view.
 * Each query remains server scoped; this never replaces ABAC with a global scan.
 */
export function subscribeToScopedSampleCollection(
  database: Firestore,
  collectionName: string,
  scope: SampleDataScope,
  authorizedIds: readonly string[],
  onRows: (rows: QueryDocumentSnapshot<DocumentData>[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const chunks = scope === "ORG" ? [null] : chunkSampleSubjectIds(authorizedIds);
  if (chunks.length === 0) { onRows([]); return () => undefined; }
  const snapshots = new Map<number, QueryDocumentSnapshot<DocumentData>[]>();
  const emit = () => {
    if (snapshots.size !== chunks.length) return;
    const merged = new Map<string, QueryDocumentSnapshot<DocumentData>>();
    snapshots.forEach(rows => rows.forEach(row => merged.set(row.id, row)));
    onRows([...merged.values()].sort((a, b) => a.id.localeCompare(b.id)));
  };
  const unsubscribers = chunks.map((ids, index) => onSnapshot(
    ids === null ? collection(database, collectionName) : ids.length === 1
      ? query(collection(database, collectionName), where("repId", "==", ids[0]))
      : query(collection(database, collectionName), where("repId", "in", ids)),
    snapshot => { snapshots.set(index, snapshot.docs); emit(); },
    error => onError?.(error),
  ));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}
