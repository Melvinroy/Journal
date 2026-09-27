import type { CloudTradeRow } from "./cloud-trade-contract";
import { cloudWritesAcknowledged } from "./cloud-write-acknowledgment";

export type CloudDraft = Omit<CloudTradeRow, "id">;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (owner: string) => {
  if (!owner.trim()) throw new Error("A draft requires an account.");
  return `brontide-cloud-trade-draft-v1:${encodeURIComponent(owner)}`;
};

export function readCloudDraft(storage: DraftStorage, owner: string): { raw: string | null; draft: CloudDraft | null } {
  const raw = storage.getItem(key(owner));
  if (raw === null) return { raw, draft: null };
  const draft = JSON.parse(raw) as CloudDraft;
  if (!cloudWritesAcknowledged([draft], [{ ...draft, id: "recovery-draft" }])) throw new Error("Unreadable draft.");
  return { raw, draft };
}

/** Save before sending; do not overwrite another window's draft or unread data. */
export function saveCloudDraft(storage: DraftStorage, owner: string, draft: CloudDraft, previous: string | null | undefined): string {
  if (previous === undefined || storage.getItem(key(owner)) !== previous) throw new Error("Draft changed.");
  if (!cloudWritesAcknowledged([draft], [{ ...draft, id: "recovery-draft" }])) throw new Error("Invalid draft.");
  const raw = JSON.stringify(draft);
  storage.setItem(key(owner), raw);
  return raw;
}

/** A successful old request cannot remove a newer recovery copy. */
export function clearCloudDraft(storage: DraftStorage, owner: string, receipt: string): boolean {
  try {
    if (storage.getItem(key(owner)) !== receipt) return false;
    storage.removeItem(key(owner));
    return true;
  } catch { return false; }
}
