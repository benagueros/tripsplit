import { useEffect, useRef, useState } from "react";
import { functionsUrl, getTripJwt } from "../lib/supabase";
import { centsToDollars, dollarsToCents, formatMoney } from "../lib/money";
import { saveReceiptExpense, updateReceiptExpense } from "../lib/store";
import { startPlusCheckout } from "../lib/plus";
import type { Member, OcrResult } from "../lib/types";
import Icon from "../components/Icon";
import { Avatar, PersonChip } from "../components/Person";
import { SnapArt } from "../components/FeatureArt";

const STEPS = ["scan", "correct", "claim"] as const;
const STEP_LABELS = ["Scan", "Check", "Claim"];

interface DraftItem {
  tempId: string;
  name: string;
  qty: string; // as typed, e.g. "2"
  amount: string; // dollars as typed, e.g. "6.98" — the LINE TOTAL, not unit price
}

/** A person's share of a line item. qty is the relative portion (default 1). */
export interface ItemClaim {
  member_id: string;
  qty: number;
}

/** Qty input that lets you delete/retype freely; commits valid numbers. */
function QtyInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      type="text"
      inputMode="numeric"
      className="qty"
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        // Commit live when it's a valid qty so the $ updates as you type.
        if (/^[1-9]\d*$/.test(v)) onCommit(parseInt(v, 10));
      }}
      onBlur={() => {
        // On blur, reset to the committed value if what's typed isn't valid.
        if (!/^[1-9]\d*$/.test(text)) setText(String(value));
      }}
    />
  );
}

/** Parsed quantity, or null when the field doesn't hold a valid qty. */
function parseQty(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Parsed amount in cents, or null when the field doesn't hold a valid amount.
 *  Negative values are allowed: discount/adjustment lines carry them. */
function parseAmountCents(s: string): number | null {
  if (s.trim() === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export interface EditReceiptData {
  expenseId: string;
  name: string;
  totalCents: number;
  paidBy: string;
  items: { id: string; name: string; qty: number; price_cents: number }[];
  claims: Map<string, { member_id: string; qty: number }[]>; // keyed by item id
}

export default function ReceiptFlow({
  tripId,
  members,
  onDone,
  onCancel,
  editData,
}: {
  tripId: string;
  members: Member[];
  onDone: () => void;
  onCancel: () => void;
  editData?: EditReceiptData;
}) {
  const editing = !!editData;
  // Remap edit claims from real item ids to temp ids (tmp-<sort index>),
  // matching the key scheme save/update use.
  const initialClaims = (): Map<string, ItemClaim[]> => {
    if (!editData) return new Map();
    const m = new Map<string, ItemClaim[]>();
    editData.items.forEach((it, i) => {
      m.set(`tmp-${i}`, editData.claims.get(it.id) ?? []);
    });
    return m;
  };
  const [step, setStep] = useState<"scan" | "correct" | "claim">(editing ? "correct" : "scan");
  const [scanning, setScanning] = useState(false);
  const [scanSecs, setScanSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scansLeft, setScansLeft] = useState<number | null>(null);
  // True when the last scan failed on the monthly quota — the error area
  // then offers a direct upgrade path instead of a dead end.
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [items, setItems] = useState<DraftItem[]>(
    editData
      ? editData.items.map((it, i) => ({
          tempId: `tmp-${i}`,
          name: it.name,
          qty: String(it.qty),
          amount: centsToDollars(it.price_cents),
        }))
      : []
  );
  const [name, setName] = useState(editData?.name ?? "");
  const [totalStr, setTotalStr] = useState(editData ? centsToDollars(editData.totalCents) : "");
  const [paidByChoice, setPaidBy] = useState(editData?.paidBy ?? members[0]?.id ?? "");
  const [claims, setClaims] = useState<Map<string, ItemClaim[]>>(initialClaims);
  const [viewerChoice, setViewingAs] = useState(members[0]?.id ?? "");
  // The flow can stay open (hidden) while people are removed from the trip,
  // so drop anyone who is gone before showing or saving.
  const memberIds = new Set(members.map((m) => m.id));
  const paidBy = memberIds.has(paidByChoice) ? paidByChoice : members[0]?.id ?? "";
  const viewingAs = memberIds.has(viewerChoice) ? viewerChoice : members[0]?.id ?? "";
  const liveClaims = new Map(
    [...claims].map(([itemId, cs]) => [itemId, cs.filter((c) => memberIds.has(c.member_id))])
  );
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Latest name value for async handlers (e.g. the scan callback): reading
  // `name` directly would capture state as of render time and could clobber
  // text typed while a scan is in flight.
  const nameValueRef = useRef(name);
  useEffect(() => {
    nameValueRef.current = name;
  }, [name]);

  // Tick a seconds counter while a scan is in flight so the status copy can
  // escalate honestly on slow reads instead of staring back silently.
  useEffect(() => {
    if (!scanning) return;
    setScanSecs(0);
    const t = window.setInterval(() => setScanSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [scanning]);

  const scan = async (file: File) => {
    setError(null);
    setQuotaBlocked(false);
    setScanning(true);
    try {
      const buf = await file.arrayBuffer();
      // Downscale huge photos to keep the vision call fast and cheap.
      const image_base64 = await downscale(buf, file.type);
      const res = await fetch(functionsUrl("ocr-scan"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getTripJwt()}`,
        },
        body: JSON.stringify({ image_base64, mime_type: "image/jpeg" }),
      });
      const data = (await res.json()) as OcrResult & { error?: string; scans_remaining?: number; quota_exceeded?: boolean };
      if (!res.ok) {
        // Surface the paywall as an upgrade opportunity, not a dead end:
        // this is the highest-intent conversion moment in the product.
        if (data.quota_exceeded) setQuotaBlocked(true);
        throw new Error(data.error ?? "Scan failed.");
      }
      setQuotaBlocked(false);
      setItems(
        data.items.map((it, i) => ({
          tempId: `tmp-${i}`,
          name: it.name,
          qty: String(it.qty ?? 1),
          amount: centsToDollars(it.price_cents ?? 0),
        }))
      );
      if (data.total_cents != null) setTotalStr(centsToDollars(data.total_cents));
      // Autofill the receipt name from the merchant, but never overwrite
      // something the user already typed.
      const merchant = (data.merchant_name ?? "").trim();
      if (merchant && !nameValueRef.current.trim()) setName(merchant.slice(0, 80));
      if (typeof data.scans_remaining === "number") setScansLeft(data.scans_remaining);
      setStep("correct");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const updateItem = (tempId: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it)));

  const removeItem = (tempId: string) =>
    setItems((prev) => prev.filter((it) => it.tempId !== tempId));

  const toggleClaim = (tempId: string, memberId: string) => {
    setClaims((prev) => {
      const next = new Map(prev);
      const cur = next.get(tempId) ?? [];
      if (cur.some((c) => c.member_id === memberId)) {
        next.set(
          tempId,
          cur.filter((c) => c.member_id !== memberId)
        );
      } else {
        next.set(tempId, [...cur, { member_id: memberId, qty: 1 }]);
      }
      return next;
    });
  };

  const setClaimQty = (tempId: string, memberId: string, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1) return;
    setClaims((prev) => {
      const next = new Map(prev);
      const cur = next.get(tempId) ?? [];
      next.set(
        tempId,
        cur.map((c) => (c.member_id === memberId ? { ...c, qty: Math.floor(qty) } : c))
      );
      return next;
    });
  };

  // Numeric view of the draft items. The correct step validates before
  // allowing Next, so fallbacks here are just a safety net.
  const parsedItems = items.map((it) => ({
    tempId: it.tempId,
    name: it.name.trim(),
    qty: parseQty(it.qty) ?? 1,
    price_cents: parseAmountCents(it.amount) ?? 0,
  }));

  // price_cents already holds the LINE TOTAL per the OCR contract, so the
  // subtotal is a plain sum — never multiplied by qty again.
  const itemsSubtotal = items.reduce((a, it) => a + (parseAmountCents(it.amount) ?? 0), 0);

  const nextToClaim = () => {
    setError(null);
    if (!name.trim()) {
      setError("Give this receipt a name first (e.g. Franklin BBQ).");
      // Jump to the name field so it's visible on long receipts.
      nameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameRef.current?.focus();
      return;
    }
    if (items.length === 0) { setError("Add at least one line item."); return; }
    for (const it of items) {
      const label = it.name.trim() || "An item";
      if (!it.name.trim()) { setError("Every item needs a name."); return; }
      if (parseQty(it.qty) == null) { setError(`"${label}" needs a quantity of 1 or more.`); return; }
      if (parseAmountCents(it.amount) == null) { setError(`"${label}" needs a valid amount.`); return; }
    }
    setStep("claim");
  };

  const claimAll = () => {
    const next = new Map(claims);
    for (const it of items) {
      const cur = next.get(it.tempId) ?? [];
      if (!cur.some((c) => c.member_id === viewingAs)) {
        next.set(it.tempId, [...cur, { member_id: viewingAs, qty: 1 }]);
      }
    }
    setClaims(next);
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError("Name this receipt (e.g. Franklin BBQ)."); return; }
    if (items.length === 0) { setError("Add at least one line item."); return; }
    let totalCents: number;
    try {
      totalCents = dollarsToCents(totalStr);
    } catch {
      setError("Enter the receipt total.");
      return;
    }
    if (totalCents < itemsSubtotal) {
      setError(`Total (${formatMoney(totalCents)}) can't be less than the items (${formatMoney(itemsSubtotal)}).`);
      return;
    }
    // Note: claim quantities are proportional shares (settle.ts splits by
    // weight), so any number of people can split any line — no cap against
    // the item's qty. The math reconciles to the line total regardless.
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        totalCents,
        paidBy,
        items: parsedItems.map(({ tempId, name, qty, price_cents }) => ({ tempId, name, qty, price_cents })),
        claims: liveClaims,
      };
      if (editing && editData) {
        await updateReceiptExpense({ expenseId: editData.expenseId, ...payload });
      } else {
        await saveReceiptExpense({ tripId, ...payload });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setSaving(false);
    }
  };

  const stepIdx = STEPS.indexOf(step);
  const taxTip = Math.max(0, (() => { try { return dollarsToCents(totalStr); } catch { return 0; } })() - itemsSubtotal);

  return (
    <>
      <ol className="stepper" aria-label="Receipt steps">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className={i === stepIdx ? "on" : i < stepIdx ? "done" : ""} aria-current={i === stepIdx ? "step" : undefined}>
            <span>{i < stepIdx ? <Icon name="check" size={13} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && <div className="err">{error}</div>}
      {quotaBlocked && (
        <div className="card glow">
          <div className="row">
            <span className="tile"><Icon name="sparkle" size={22} /></span>
            <div className="grow">
              <b>TripSplit Plus</b>
              <div className="muted">
                200 receipt scans/month for this trip · $2.99/mo. Keep scanning right now.
              </div>
            </div>
          </div>
          <button
            className="btn"
            disabled={upgrading}
            onClick={async () => {
              setUpgrading(true);
              try {
                await startPlusCheckout();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't start checkout.");
                setUpgrading(false);
              }
            }}
          >
            {upgrading ? "…" : "Upgrade this trip"}
          </button>
        </div>
      )}

      {step === "scan" && (
        <>
          <div className="screen-head">
            <h1>Scan receipt</h1>
            <p className="muted">
              Snap the receipt — line items get pulled out automatically. You'll
              correct anything it misreads next.
              {scansLeft !== null && ` ${scansLeft} scans left this month.`}
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset so the same file can be picked again, and clear the
              // capture hint for next time.
              e.target.value = "";
              e.target.removeAttribute("capture");
              if (f) scan(f);
            }}
          />
          <div className="stage scan-stage" aria-live="polite">
            <SnapArt />
            {scanning && (
              <>
                <b>Reading your receipt…</b>
                <div className="muted" role="status">
                  {scanSecs < 12
                    ? "This usually takes 10–20 seconds."
                    : "Still working — the reader is being thorough. Hang tight."}
                </div>
              </>
            )}
          </div>
          {!scanning && (
            <div className="btnrow">
              <button
                className="btn"
                onClick={() => {
                  // capture="environment" opens the rear camera directly.
                  fileRef.current?.setAttribute("capture", "environment");
                  fileRef.current?.click();
                }}
              >
                <Icon name="camera" /> Take photo
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  // No capture attribute: the OS offers camera OR photo library.
                  fileRef.current?.removeAttribute("capture");
                  fileRef.current?.click();
                }}
              >
                <Icon name="image" /> Upload photo
              </button>
            </div>
          )}
          <button
            className="btn ghost"
            disabled={scanning}
            onClick={() => {
              setItems([{ tempId: "tmp-0", name: "", qty: "1", amount: "" }]);
              setStep("correct");
            }}
          >
            Enter items manually instead
          </button>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
        </>
      )}

      {step === "correct" && (
        <>
          <div className="screen-head">
            <h1>{editing ? "Edit receipt" : "Check the items"}</h1>
            <p className="muted">Fix anything the scan got wrong.</p>
          </div>
          <label className="field">
            Receipt name
            <input
              ref={nameRef}
              type="text" placeholder="Franklin BBQ" value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="row">
            <label className="field grow">
              Paid by
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className="field grow">
              Receipt total ($)
              <input
                type="number" inputMode="decimal" min="0" step="0.01"
                placeholder="0.00" value={totalStr}
                onChange={(e) => setTotalStr(e.target.value)}
              />
            </label>
          </div>
          <div className="paper-wrap">
            <div className="paper">
              {items.map((it) => (
                <div className="item-edit" key={it.tempId}>
                  <input
                    type="text" placeholder="Item name" aria-label="Item name" value={it.name}
                    onChange={(e) => updateItem(it.tempId, { name: e.target.value })}
                  />
                  <label className="field">
                    Qty
                    <input
                      type="number" min="1" value={it.qty}
                      onChange={(e) => updateItem(it.tempId, { qty: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Line total ($)
                    <input
                      type="number" inputMode="decimal" min="0" step="0.01"
                      value={it.amount}
                      onChange={(e) => updateItem(it.tempId, { amount: e.target.value })}
                    />
                  </label>
                  <button className="icon-btn" onClick={() => removeItem(it.tempId)} aria-label="Remove item">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              ))}
              <button
                className="btn dashed"
                onClick={() => setItems([...items, { tempId: `tmp-${Date.now()}`, name: "", qty: "1", amount: "" }])}
              >
                <Icon name="plus" size={18} /> Add item
              </button>
              <div className="subtotal">
                <span>Items subtotal</span>
                <b>{formatMoney(itemsSubtotal)}</b>
              </div>
            </div>
          </div>
          <button className="btn" onClick={nextToClaim}>
            Next: claim items <Icon name="arrowRight" size={18} />
          </button>
          {!editing && <button className="btn ghost" onClick={() => setStep("scan")}>← Back</button>}
          {editing && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
        </>
      )}

      {step === "claim" && (
        <>
          <div className="screen-head">
            <h1>Who had what?</h1>
            <p className="muted">
              Pass the phone around — or tap a line to split it between several people.
            </p>
          </div>
          <div className="card">
            <span className="eyebrow">Viewing as</span>
            <div className="chiprow" role="group" aria-label="Viewing as">
              {members.map((m, i) => (
                <PersonChip
                  key={m.id}
                  name={m.name}
                  index={i}
                  on={viewingAs === m.id}
                  onClick={() => setViewingAs(m.id)}
                />
              ))}
            </div>
            <button className="btn secondary" onClick={claimAll}>
              {members.find((m) => m.id === viewingAs)?.name} claims everything
            </button>
          </div>
          {parsedItems.map((it) => {
            const assignees = liveClaims.get(it.tempId) ?? [];
            const totalQty = assignees.reduce((a, c) => a + c.qty, 0);
            const perUnit = it.qty > 0 ? Math.round(it.price_cents / it.qty) : it.price_cents;
            return (
              <div className={`card claim-item${assignees.length === 0 ? "" : " glow"}`} key={it.tempId}>
                <div className="row between" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <b>{it.name || "Unnamed item"}</b>
                    <div className="meta">
                      {it.qty} × {formatMoney(perUnit)} = {formatMoney(it.price_cents)}
                      {assignees.length > 1 &&
                        ` · split ${assignees.length} ways`}
                    </div>
                  </div>
                  <div className="ex-amt">{formatMoney(it.price_cents)}</div>
                </div>
                <div className="chiprow">
                  {members.map((m: Member, i) => (
                    <PersonChip
                      key={m.id}
                      name={m.name}
                      index={i}
                      on={assignees.some((c) => c.member_id === m.id)}
                      onClick={() => toggleClaim(it.tempId, m.id)}
                    />
                  ))}
                </div>
                {assignees.length > 0 && (
                  <div className="assignees">
                    {assignees.map((c) => {
                      const idx = members.findIndex((mm) => mm.id === c.member_id);
                      const m = members[idx];
                      const share = totalQty > 0 ? Math.round((it.price_cents * c.qty) / totalQty) : 0;
                      return (
                        <div key={c.member_id} className="assignee">
                          <Avatar name={m?.name ?? "?"} index={idx} small />
                          <span>{m?.name ?? "?"}</span>
                          <span className="share">{formatMoney(share)}</span>
                          <QtyInput
                            value={c.qty}
                            onCommit={(n) => setClaimQty(it.tempId, c.member_id, n)}
                            ariaLabel={`Quantity for ${m?.name}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div className="info">
            <Icon name="sparkle" size={18} />
            <span>
              Tax + tip ({formatMoney(taxTip)}) split by everyone's share.
              Anything unclaimed splits evenly.
            </span>
          </div>
          <button className="btn" disabled={saving} onClick={save}>
            {saving ? "Saving…" : editing ? "Save changes" : "Save receipt"}
          </button>
          <button className="btn ghost" onClick={() => setStep("correct")}>← Back</button>
        </>
      )}
    </>
  );
}

/** Shrink a photo to max 1600px on the long edge and return JPEG base64. */
function downscale(buf: ArrayBuffer, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buf], { type });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}
