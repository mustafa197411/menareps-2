export type CommittedOperationOutcome = {
  committed: true;
  auditWarning: boolean;
};

export async function commitAllocationThenAudit(input: {
  commit: () => Promise<unknown>;
  audit: () => Promise<unknown>;
}): Promise<CommittedOperationOutcome> {
  await input.commit();
  try {
    await input.audit();
    return { committed: true, auditWarning: false };
  } catch (error) {
    console.error("[SAMPLE_ALLOCATION_AUDIT_WARNING]", error);
    return { committed: true, auditWarning: true };
  }
}

export type BulkCommittedOperationOutcome<T> = {
  committedItems: T[];
  failedItems: Array<{ item: T; error: unknown }>;
  auditWarning: boolean;
};

export async function commitBulkAllocationsThenAudit<T>(input: {
  items: T[];
  commitItem: (item: T) => Promise<unknown>;
  audit: (committedItems: T[]) => Promise<unknown>;
}): Promise<BulkCommittedOperationOutcome<T>> {
  const committedItems: T[] = [];
  const failedItems: Array<{ item: T; error: unknown }> = [];

  for (const item of input.items) {
    try {
      await input.commitItem(item);
      committedItems.push(item);
    } catch (error) {
      failedItems.push({ item, error });
    }
  }

  let auditWarning = false;
  if (committedItems.length > 0) {
    try {
      await input.audit(committedItems);
    } catch (error) {
      console.error("[BULK_SAMPLE_ALLOCATION_AUDIT_WARNING]", error);
      auditWarning = true;
    }
  }

  return { committedItems, failedItems, auditWarning };
}
