/*
 * Integration test against a LOCAL Supabase stack that is running Realtime (it is skipped otherwise; CI does not start
 * Realtime). Run it with a fresh `supabase db reset`:
 *
 *   REALTIME_INTEGRATION=1 \
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable/anon key from `supabase status`> \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key from `supabase status`> \
 *   node node_modules/vitest/vitest.mjs run lib/realtime/subscribe-location.integration.test.ts
 *
 * Proves, with real sign-ins and real WAL events: an authorised member receives a price override, a sold-out change
 * and a table status change within seconds; another org's owner and a location-scoped user WITHOUT access to the
 * location receive nothing; and `qr_token` never appears in any payload, even when the token is rotated.
 * (Realtime strips every column the subscriber role cannot SELECT, in realtime.apply_rls; the column grants from the
 * venue migration are what keep qr_token out. `qr_rotated_at` is selectable by members and may appear.)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subscribeLocation } from "./subscribe-location";

const RUN = !!process.env.REALTIME_INTEGRATION;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "restomate-local-dev"; // the documented local-only seed password
const JAKSEL = "de000000-0000-4000-8000-0000000000a1";
const BANDUNG = "de000000-0000-4000-8000-0000000000a2";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Seen = { kind: "override" | "table"; payload: unknown }[];

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  // make sure Realtime uses this user's JWT
  const { data } = await c.auth.getSession();
  c.realtime.setAuth(data.session!.access_token);
  return c;
}

async function listen(c: SupabaseClient, locationId: string): Promise<{ seen: Seen; off: () => void }> {
  const seen: Seen = [];
  let connected!: () => void;
  const ready = new Promise<void>((r) => (connected = r));
  const off = subscribeLocation(c, locationId, {
    onOverride: (payload) => seen.push({ kind: "override", payload }),
    onTable: (payload) => seen.push({ kind: "table", payload }),
    onStatus: (s) => { if (s === "connected") connected(); },
  });
  const ok = await Promise.race([ready.then(() => true), sleep(10_000).then(() => false)]);
  if (!ok) throw new Error(`subscription to location ${locationId} never connected`);
  await sleep(1500); // let the postgres_changes bindings register server-side
  return { seen, off };
}

describe.skipIf(!RUN)("Realtime per location (local stack)", () => {
  let admin: SupabaseClient;
  const subs: { off: () => void }[] = [];
  const clients: SupabaseClient[] = [];
  const results: Record<string, Seen> = {};

  beforeAll(async () => {
    admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const owner = await signedIn("owner@demo.local");
    const cashier = await signedIn("cashier@demo.local"); // works at Jakarta Selatan only
    const stranger = await signedIn("owner@other.local"); // another org
    clients.push(owner, cashier, stranger);
    const l1 = await listen(owner, JAKSEL);
    subs.push(l1);
    const l2 = await listen(cashier, JAKSEL);
    subs.push(l2);
    const l3 = await listen(stranger, JAKSEL);
    subs.push(l3);
    const l4 = await listen(cashier, BANDUNG); // location they cannot access
    subs.push(l4);
    results.owner = l1.seen;
    results.cashier = l2.seen;
    results.otherOrg = l3.seen;
    results.cashierWrongLocation = l4.seen;

    // changes made by the service role (what the app's server actions / RPCs do)
    const { data: item } = await admin.from("menu_items").select("id").eq("name", "Nasi Goreng Kampung").single();
    const { error: e1 } = await admin.from("location_menu_overrides").update({ price_override: 36000 }).eq("location_id", JAKSEL).eq("item_id", item!.id);
    const { error: e2 } = await admin.from("location_menu_overrides").update({ sold_out_until: new Date(Date.now() + 3600_000).toISOString() }).eq("location_id", JAKSEL).eq("item_id", item!.id);
    const { error: e3 } = await admin.from("tables").update({ status: "occupied" }).eq("location_id", JAKSEL).eq("label", "T1");
    const { error: e4 } = await admin.from("tables").update({ qr_token: "rotated-for-realtime-test", qr_rotated_at: new Date().toISOString() }).eq("location_id", JAKSEL).eq("label", "T2");
    expect([e1, e2, e3, e4]).toEqual([null, null, null, null]);
    await sleep(4000);
  }, 60_000);

  afterAll(async () => {
    for (const s of subs) s.off();
    await Promise.all([...clients, admin].filter(Boolean).map((c) => c.removeAllChannels()));
    for (const c of clients) c.realtime.disconnect();
  });

  it("an authorised owner receives the override, sold-out and table changes", () => {
    const o = results.owner!;
    expect(o.filter((e) => e.kind === "override").length).toBeGreaterThanOrEqual(2);
    expect(o.some((e) => e.kind === "table" && JSON.stringify(e.payload).includes('"occupied"'))).toBe(true);
    const sold = o.find((e) => e.kind === "override" && JSON.stringify(e.payload).includes("sold_out_until") && !JSON.stringify(e.payload).includes('"sold_out_until":null'));
    expect(sold).toBeTruthy();
  });
  it("a cashier scoped to this location receives the same changes", () => {
    expect(results.cashier!.length).toBeGreaterThanOrEqual(3);
  });
  it("another org's owner receives nothing", () => {
    expect(results.otherOrg).toHaveLength(0);
  });
  it("a cashier subscribing to a location they cannot access receives nothing", () => {
    expect(results.cashierWrongLocation).toHaveLength(0);
  });
  it("qr_token (and the rotated token value) never appear in any payload, including the rotation event", () => {
    const everything = JSON.stringify(Object.values(results));
    expect(everything).not.toMatch(/qr_token|rotated-for-realtime-test/);
    // the rotation did produce a table event (so the check above is meaningful)
    expect(results.owner!.some((e) => e.kind === "table" && JSON.stringify(e.payload).includes('"label":"T2"'))).toBe(true);
  });
});
