/** Private local paper drafts. This client has no broker or order endpoint. */

export type LocalPlanScope = Readonly<{
  scopeId: string;
  hasSavedPlan: boolean;
  environment: "paper";
  executionEnabled: false;
  reviewEligible: false;
}>;

export type LocalPlanReceipt = Readonly<{
  scopeId: string;
  planId: string;
  planRevision: string;
  contentDigest: string;
  executionEnabled: false;
  reviewEligible: false;
}>;

export type LocalSavedPlan = LocalPlanReceipt & Readonly<{
  savedPlan: Readonly<Record<string, unknown>>;
}>;

const hex = /^[0-9a-f]{64}$/;
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sampleSnapshot = (value: unknown) => object(value) &&
  (value.status === "sample" || value.source === "Simulated fixture");

export function localPlanScopeFromResponse(value: unknown): LocalPlanScope | null {
  if (!object(value) || typeof value.scopeId !== "string" || !hex.test(value.scopeId) ||
      typeof value.hasSavedPlan !== "boolean" || value.environment !== "paper" ||
      value.executionEnabled !== false || value.reviewEligible !== false) return null;
  return value as LocalPlanScope;
}

export function localPlanReceiptFromResponse(value: unknown,
  expectedScopeId: string, expectedPlanId: string, expectedRevision: string,
): LocalPlanReceipt | null {
  if (!object(value) || !hex.test(expectedScopeId) ||
      value.scopeId !== expectedScopeId || value.planId !== expectedPlanId ||
      value.planRevision !== expectedRevision ||
      typeof value.planId !== "string" || !uuid4.test(value.planId) ||
      typeof value.planRevision !== "string" || !uuid4.test(value.planRevision) ||
      typeof value.contentDigest !== "string" || !hex.test(value.contentDigest) ||
      value.executionEnabled !== false || value.reviewEligible !== false) return null;
  return value as LocalPlanReceipt;
}

export function localSavedPlanFromResponse(value: unknown,
  expectedScopeId: string,
): LocalSavedPlan | null {
  if (!object(value) || !object(value.savedPlan)) return null;
  const saved = value.savedPlan;
  const receipt = localPlanReceiptFromResponse(value, expectedScopeId,
    String(saved.planId ?? ""), String(saved.planRevision ?? ""));
  if (!receipt || saved.schemaVersion !== 2 || "origin" in saved ||
      sampleSnapshot(saved.marketSnapshot) ||
      !object(saved.capturedEntrySource) ||
      !["Manual", "Local EOD close", "IBKR TWS snapshot"].includes(
        String(saved.capturedEntrySource.source))) return null;
  return { ...receipt, savedPlan: saved };
}

const headers = (csrf: string) => ({
  "X-Brontide-Local": "1", "X-Brontide-CSRF": csrf,
});

export async function readLocalPlanScope(csrf: string,
  signal?: AbortSignal): Promise<LocalPlanScope> {
  const response = await fetch("/v1/local/plans/status", {
    credentials: "same-origin", cache: "no-store", headers: headers(csrf), signal,
  });
  if (!response.ok) throw new Error("Private paper plan storage is unavailable.");
  const parsed = localPlanScopeFromResponse(await response.json());
  if (!parsed) throw new Error("Private paper plan scope changed or is invalid.");
  return parsed;
}

export async function readLatestLocalPlan(csrf: string, expectedScopeId: string,
  signal?: AbortSignal): Promise<LocalSavedPlan | null> {
  const response = await fetch("/v1/local/plans/current", {
    credentials: "same-origin", cache: "no-store", headers: headers(csrf), signal,
  });
  if (response.status === 404) {
    const current = await readLocalPlanScope(csrf, signal);
    if (current.scopeId !== expectedScopeId || current.hasSavedPlan) {
      throw new Error("Private paper plan scope changed while loading.");
    }
    return null;
  }
  if (!response.ok) throw new Error("Saved private paper plan is unavailable.");
  const parsed = localSavedPlanFromResponse(await response.json(), expectedScopeId);
  if (!parsed) throw new Error("Saved private paper plan changed or is invalid.");
  return parsed;
}

export async function saveLocalPlan(csrf: string, expectedScopeId: string,
  savedPlan: Readonly<Record<string, unknown>>, expectedRevision: string | null,
  expectedActiveRevision: string | null, signal?: AbortSignal): Promise<LocalPlanReceipt> {
  if (!hex.test(expectedScopeId) || !uuid4.test(String(savedPlan.planId ?? "")) ||
      !uuid4.test(String(savedPlan.planRevision ?? "")) ||
      (expectedActiveRevision !== null && !uuid4.test(expectedActiveRevision)) ||
      savedPlan.schemaVersion !== 2 || "origin" in savedPlan ||
      sampleSnapshot(savedPlan.marketSnapshot) ||
      !object(savedPlan.capturedEntrySource) ||
      !["Manual", "Local EOD close", "IBKR TWS snapshot"].includes(
        String(savedPlan.capturedEntrySource.source))) {
    throw new Error("The private paper plan scope or revision is invalid.");
  }
  const response = await fetch("/v1/local/plans", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { ...headers(csrf), "Content-Type": "application/json" },
    body: JSON.stringify({ savedPlan, expectedRevision, expectedScopeId,
      expectedActiveRevision }), signal,
  });
  if (!response.ok) throw new Error("Private paper plan was not confirmed as saved.");
  const parsed = localPlanReceiptFromResponse(await response.json(), expectedScopeId,
    String(savedPlan.planId), String(savedPlan.planRevision));
  if (!parsed) throw new Error("Private paper plan save acknowledgement is invalid.");
  return parsed;
}
