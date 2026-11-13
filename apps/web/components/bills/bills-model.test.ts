import { describe, expect, it } from "vitest";
import {
  assignLine, canCreateBill, canPay, cashVariance, changeFor, checkPayment, closeNeedsNote, closeNoteOk, createAttemptTracker,
  emptyAssignments, outstandingOf, parsePositiveAmount, refundableLeft, unassignedLines, validateSplit, type PaymentDraft, type OrderStatus,
} from "./bills-model";

describe("when a bill can be created", () => {
  it("accepted, preparing, ready and served only", () => {
    const all: OrderStatus[] = ["draft", "placed", "accepted", "preparing", "ready", "served", "completed", "cancelled"];
    expect(all.filter(canCreateBill)).toEqual(["accepted", "preparing", "ready", "served"]);
  });
});

describe("split validation mirrors INVALID_SPLIT", () => {
  const lines = ["a", "b", "c"];
  it("none needs nothing; equal needs 2-20 shares", () => {
    expect(validateSplit("none", null, null, lines)).toBeNull();
    for (const n of [2, 3, 20]) expect(validateSplit("equal", n, null, lines)).toBeNull();
    for (const n of [null, 0, 1, 21, 2.5]) expect(validateSplit("equal", n as number | null, null, lines)).toBe("count");
  });
  it("by_item: every line exactly once, no empty bill, 2-20 bills", () => {
    expect(validateSplit("by_item", null, [["a", "b"], ["c"]], lines)).toBeNull();
    expect(validateSplit("by_item", null, [["a"], ["c"]], lines)).toBe("assignments_incomplete");
    expect(validateSplit("by_item", null, [["a", "b", "c"], []], lines)).toBe("assignments_empty_bill");
    expect(validateSplit("by_item", null, [["a", "b"], ["b", "c"]], lines)).toBe("assignments_duplicate");
    expect(validateSplit("by_item", null, [["a", "b", "c"]], lines)).toBe("assignments_count");
    expect(validateSplit("by_item", null, null, lines)).toBe("assignments_count");
    expect(validateSplit("by_item", null, [["a", "b"], ["c"]], ["a", "b", "c", "d"])).toBe("assignments_incomplete");
  });
  it("assigning a line moves it, never copies it", () => {
    let a = emptyAssignments(2);
    a = assignLine(a, "x", 0);
    a = assignLine(a, "y", 0);
    a = assignLine(a, "x", 1);
    expect(a).toEqual([["y"], ["x"]]);
    expect(unassignedLines(["x", "y", "z"], a)).toEqual(["z"]);
  });
});

describe("amounts and change (whole Rupiah, never floats)", () => {
  it("parses typed amounts through lib/money and rejects junk and zero", () => {
    expect(parsePositiveAmount("Rp 35.000", "IDR")).toEqual({ ok: true, value: 35000 });
    for (const t of ["", "0", "abc", "35.5", "-5000", "1e5"]) expect(parsePositiveAmount(t, "IDR").ok).toBe(false);
  });
  it("change is tendered - amount, null when short", () => {
    expect(changeFor(35000, 50000)).toBe(15000);
    expect(changeFor(35000, 35000)).toBe(0);
    expect(changeFor(35000, 34999)).toBeNull();
    expect(changeFor(0, 100)).toBeNull();
  });
});

describe("checkPayment mirrors record_payment", () => {
  const base: PaymentDraft = { method: "cash", amount: "35000", tendered: "50000", methodLabel: "", approvalCode: "" };
  it("cash: tendered must cover the amount; shows change", () => {
    expect(checkPayment(base, "IDR", 100000)).toEqual({ ok: true, amount: 35000, tendered: 50000, change: 15000 });
    expect(checkPayment({ ...base, tendered: "20000" }, "IDR", 100000)).toMatchObject({ ok: false, field: "tendered", reason: "tendered_low" });
    expect(checkPayment({ ...base, tendered: "" }, "IDR", 100000)).toMatchObject({ ok: false, field: "tendered" });
  });
  it("never accepts more than is owed (partial payments are fine)", () => {
    expect(checkPayment({ ...base, amount: "100001" }, "IDR", 100000)).toMatchObject({ ok: false, field: "amount", reason: "exceeds" });
    expect(checkPayment({ ...base, amount: "100000", tendered: "100000" }, "IDR", 100000)).toMatchObject({ ok: true, amount: 100000 });
    expect(checkPayment({ ...base, amount: "1000", tendered: "1000" }, "IDR", 100000)).toMatchObject({ ok: true, amount: 1000 });
  });
  it("EDC: no tendered; the approval code is optional but must be 4-12 letters/digits", () => {
    const edc: PaymentDraft = { ...base, method: "edc_card", tendered: "" };
    expect(checkPayment(edc, "IDR", 100000)).toEqual({ ok: true, amount: 35000, tendered: null, change: null });
    expect(checkPayment({ ...edc, approvalCode: "AB12CD" }, "IDR", 100000).ok).toBe(true);
    for (const code of ["AB", "4111 1111 1111 1111", "AB-12CD", "A".repeat(13)]) {
      expect(checkPayment({ ...edc, approvalCode: code }, "IDR", 100000)).toMatchObject({ ok: false, field: "approvalCode" });
    }
  });
  it("other: a label of 2-40 characters is required", () => {
    const other: PaymentDraft = { ...base, method: "other", tendered: "" };
    expect(checkPayment(other, "IDR", 100000)).toMatchObject({ ok: false, field: "methodLabel" });
    expect(checkPayment({ ...other, methodLabel: "V" }, "IDR", 100000).ok).toBe(false);
    expect(checkPayment({ ...other, methodLabel: "Voucher" }, "IDR", 100000).ok).toBe(true);
    expect(checkPayment({ ...other, methodLabel: "x".repeat(41) }, "IDR", 100000).ok).toBe(false);
  });
  it("a bill takes payment only while something is owed, and never for a caller without payment data", () => {
    const bill = { total: 100000, paidTotal: 40000, paymentStatus: "partially_paid" as const };
    expect(outstandingOf(bill)).toBe(60000);
    expect(canPay(bill)).toBe(true);
    expect(canPay({ ...bill, paidTotal: 100000, paymentStatus: "paid" })).toBe(false);
    expect(canPay({ ...bill, paymentStatus: null })).toBe(false); // waiter: no payment status at all
    // gross payments: a refund never re-opens a bill
    expect(canPay({ total: 100000, paidTotal: 100000, paymentStatus: "refunded" })).toBe(false);
  });
});

describe("refunds and the cash session", () => {
  it("refundable is payment minus what was already refunded", () => {
    expect(refundableLeft({ amount: 50000, refunded: 20000 })).toBe(30000);
    expect(refundableLeft({ amount: 50000, refunded: 50000 })).toBe(0);
  });
  it("variance is signed (negative = short); a note of 3+ characters is required only when it is not 0", () => {
    expect(cashVariance(95000, 100000)).toBe(-5000);
    expect(cashVariance(100000, 100000)).toBe(0);
    expect(closeNeedsNote(0)).toBe(false);
    expect(closeNeedsNote(-1)).toBe(true);
    expect(closeNoteOk(0, "")).toBe(true);
    expect(closeNoteOk(-5000, "")).toBe(false);
    expect(closeNoteOk(-5000, "ab")).toBe(false);
    expect(closeNoteOk(-5000, "  short change  ")).toBe(true);
  });
});

describe("clientRef is per attempt and reused on retry", () => {
  it("the same body keeps its ref, a changed body mints a new one, reset starts fresh", () => {
    let n = 0;
    const t = createAttemptTracker(() => `ref-${++n}`);
    const first = t.refFor('{"amount":35000}');
    expect(t.refFor('{"amount":35000}')).toBe(first); // retry of the same attempt
    expect(t.refFor('{"amount":40000}')).not.toBe(first); // a different request never reuses a ref
    const second = t.refFor('{"amount":40000}');
    t.reset(); // after a success
    expect(t.refFor('{"amount":40000}')).not.toBe(second);
  });
});
