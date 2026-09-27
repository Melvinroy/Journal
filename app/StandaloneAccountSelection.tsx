import { useEffect, useRef, useState } from "react";
import { exactSavedAccountCheckFromResponse, localAccountReviewFromResponse, maskTypedAccount, type LocalAccountReview } from "../lib/local-account-review";
import { rememberedChoiceFromResponse } from "../lib/local-account-status";

/** This UI can save a locked paper choice; it cannot enable an order. */
export function StandaloneAccountSelection({ profileId, csrf, referenceMask, onConfirmed, onSessionInvalid }: {
  profileId: string;
  csrf: string;
  referenceMask: string;
  onConfirmed: (profileId: string, accountMask: string) => void;
  onSessionInvalid: () => void;
}) {
  const [review, setReview] = useState<LocalAccountReview | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [typedAccount, setTypedAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertainMask, setUncertainMask] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  const busyNow = useRef(false);
  const uncertainAccount = useRef<string | null>(null);
  const scope = useRef({ profileId, csrf, referenceMask });
  scope.current = { profileId, csrf, referenceMask };
  const callbacks = useRef({ onConfirmed, onSessionInvalid });
  callbacks.current = { onConfirmed, onSessionInvalid };

  useEffect(() => {
    epoch.current += 1;
    busyNow.current = false;
    uncertainAccount.current = null;
    setReview(null); setSelectedIndex(null); setTypedAccount("");
    setBusy(false); setUncertainMask(null); setMessage("");
    return () => { epoch.current += 1; uncertainAccount.current = null; };
  }, [profileId, csrf, referenceMask]);

  const current = (requestEpoch: number) => requestEpoch === epoch.current &&
    scope.current.profileId === profileId && scope.current.csrf === csrf &&
    scope.current.referenceMask === referenceMask;
  const headers = { "X-Brontide-Local": "1", "X-Brontide-CSRF": csrf };

  async function discover() {
    if (busyNow.current || uncertainMask) return;
    busyNow.current = true;
    const requestEpoch = ++epoch.current;
    setBusy(true); setReview(null); setSelectedIndex(null); setTypedAccount("");
    setMessage("");
    try {
      const response = await fetch("/v1/local/account-selection", {
        method: "POST", credentials: "same-origin", cache: "no-store", headers,
      });
      if (!current(requestEpoch)) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) callbacks.current.onSessionInvalid();
        throw new Error("Account discovery is unavailable.");
      }
      const result = localAccountReviewFromResponse(await response.json());
      if (!current(requestEpoch)) return;
      if (!result) throw new Error("Account review is inconsistent.");
      if (!result.candidates.some(candidate => candidate.mask === referenceMask)) {
        setMessage("No account seen by TWS matches your saved paper reference. Check TWS and the reference; trading remains locked.");
        return;
      }
      setReview(result);
      setMessage("TWS reported masked accounts. Different accounts can share one mask. Select the visible mask and type your full ID; Brontide checks that exact ID against fresh paper evidence before saving.");
    } catch {
      if (current(requestEpoch)) setMessage("Account discovery could not be verified. Check TWS; trading remains locked.");
    } finally {
      if (current(requestEpoch)) { busyNow.current = false; setBusy(false); }
    }
  }

  async function confirm() {
    const selected = selectedIndex === null ? null : review?.candidates[selectedIndex];
    if (busyNow.current || uncertainMask || !review || !selected ||
        selected.mask !== referenceMask || maskTypedAccount(typedAccount) !== selected.mask) return;
    busyNow.current = true;
    const requestEpoch = ++epoch.current;
    const expectedMask = selected.mask;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/v1/local/account-selection/confirm", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ selectionId: review.selectionId, index: selected.index,
          typedAccount }),
      });
      if (!current(requestEpoch)) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) callbacks.current.onSessionInvalid();
        throw new Error("Account confirmation was not acknowledged.");
      }
      const saved = rememberedChoiceFromResponse(await response.json());
      if (!current(requestEpoch)) return;
      if (saved?.kind !== "remembered" || saved.accountMask !== expectedMask) {
        throw new Error("Saved account acknowledgement is inconsistent.");
      }
      setReview(null); setTypedAccount(""); setSelectedIndex(null);
      uncertainAccount.current = null;
      callbacks.current.onConfirmed(profileId, expectedMask);
    } catch {
      if (current(requestEpoch)) {
        // Confirmation can commit before the response is lost. Its review is
        // consumed server-side, so never retransmit this POST automatically.
        setReview(null); setTypedAccount(""); setSelectedIndex(null);
        uncertainAccount.current = typedAccount;
        setUncertainMask(expectedMask);
        setMessage("The confirmation result is uncertain. Check the saved choice before starting another review. No order was sent.");
      }
    } finally {
      if (current(requestEpoch)) { busyNow.current = false; setBusy(false); }
    }
  }

  async function checkSavedChoice() {
    if (busyNow.current || !uncertainMask || !uncertainAccount.current) return;
    busyNow.current = true;
    const requestEpoch = ++epoch.current;
    const expectedMask = uncertainMask;
    const accountToCheck = uncertainAccount.current;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/v1/local/binding/check", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ typedAccount: accountToCheck }),
      });
      if (!current(requestEpoch)) return;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) callbacks.current.onSessionInvalid();
        throw new Error("Saved choice cannot be read.");
      }
      const saved = exactSavedAccountCheckFromResponse(await response.json());
      if (!current(requestEpoch)) return;
      if (saved?.exactMatch === true) {
        uncertainAccount.current = null;
        setUncertainMask(null);
        callbacks.current.onConfirmed(profileId, expectedMask);
      } else if (saved?.remembered === false) {
        uncertainAccount.current = null;
        setUncertainMask(null);
        setMessage("No account choice was saved. You can start a fresh review; trading remains locked.");
      } else {
        setMessage("A saved choice exists, but it is not the exact account from this review. Relaunch before taking another action.");
      }
    } catch {
      if (current(requestEpoch)) setMessage("Saved choice is unavailable. Do not repeat the confirmation; trading remains locked.");
    } finally {
      if (current(requestEpoch)) { busyNow.current = false; setBusy(false); }
    }
  }

  const selected = selectedIndex === null ? null : review?.candidates[selectedIndex];
  const canConfirm = !!selected && selected.mask === referenceMask &&
    maskTypedAccount(typedAccount) === selected.mask && !busy && !uncertainMask;

  return <section className="standalone-connect-steps standalone-account-review" aria-labelledby="paper-account-review-title">
    <h2 id="paper-account-review-title">Review a TWS paper account</h2>
    <p>Your private paper reference is <strong>{referenceMask}</strong>. TWS account names alone do not prove paper mode. Brontide checks that evidence again before saving one choice. Orders remain locked.</p>
    {!uncertainMask && <button type="button" className="secondary-button" disabled={busy}
      onClick={() => void discover()}>{busy && !review ? "Checking TWS accounts…" : "Find accounts in TWS"}</button>}
    {review && !uncertainMask && <form autoComplete="off" onSubmit={event => { event.preventDefault(); void confirm(); }}>
      <label htmlFor="paper-account-candidate">Masked account seen by TWS</label>
      <select id="paper-account-candidate" value={selectedIndex === null ? "" : String(selectedIndex)}
        disabled={busy} onChange={event => { setSelectedIndex(event.target.value === "" ? null : Number(event.target.value)); setTypedAccount(""); }}>
        <option value="">Choose a masked account</option>
        {review.candidates.map(candidate => <option key={candidate.index} value={candidate.index}>
          {candidate.mask}{candidate.mask === referenceMask ? " · same visible mask, exact ID not yet checked" : " · different visible mask"}
        </option>)}
      </select>
      <label htmlFor="paper-account-typed">Type the full account ID shown in your IBKR paper login</label>
      <input id="paper-account-typed" type="text" autoComplete="off" spellCheck={false}
        maxLength={32} disabled={busy} value={typedAccount}
        onChange={event => setTypedAccount(event.target.value)} />
      <button type="submit" className="secondary-button" disabled={!canConfirm}>
        {busy ? "Verifying paper account…" : "Confirm paper account choice"}
      </button>
      {selected && selected.mask !== referenceMask &&
        <p role="status">This visible mask differs from your private paper reference. It cannot be confirmed.</p>}
    </form>}
    {uncertainMask && <button type="button" className="secondary-button" disabled={busy}
      onClick={() => void checkSavedChoice()}>{busy ? "Checking saved choice…" : "Check saved choice"}</button>}
    {message && <p role={uncertainMask ? "alert" : "status"}>{message}</p>}
  </section>;
}
