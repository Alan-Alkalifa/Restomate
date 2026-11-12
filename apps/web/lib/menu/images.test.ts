import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({ forbidden: () => { throw new Forbidden("403"); }, notFound: () => { throw new Error("404"); } }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/" } }));

const ORG = "99999999-9999-4999-8999-999999999999";
const ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ITEM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_ORG = "88888888-8888-4888-8888-888888888888";

let perms: string[] = ["menu.manage"];
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo" }, locations: [], permissions: perms }),
  requirePermission: async (_o: string, p: string) => { if (!perms.includes(p)) throw new Forbidden("403"); },
}));

let item: { id: string; image_path: string | null } | null = { id: ITEM, image_path: null };
const updates: unknown[] = [];
let updateError: { code?: string } | null = null;
const storage = {
  createSignedUploadUrl: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) c[m] = () => c;
      c.update = (p: unknown) => { updates.push(p); return { eq: () => ({ eq: async () => ({ error: updateError }) }) }; };
      c.maybeSingle = async () => ({ data: item });
      return c;
    },
    storage: { from: (b: string) => { expect(b).toBe("menu-images"); return storage; } },
  }),
}));

import { clearItemImage, createItemImageUpload, setItemImage } from "./images";
import { isMenuImagePath, menuImageUrl } from "./image-url";

const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const GOOD = `${ORG}/items/${ITEM}/abcDEF123_-xyz.webp`;

beforeEach(() => {
  vi.clearAllMocks();
  perms = ["menu.manage"];
  item = { id: ITEM, image_path: null };
  updates.length = 0;
  updateError = null;
  storage.createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "http://x/sign", token: "tok", path: "p" }, error: null });
  storage.list.mockResolvedValue({ data: [{ name: "abcDEF123_-xyz.webp" }], error: null });
  storage.remove.mockResolvedValue({ data: [], error: null });
});

describe("createItemImageUpload", () => {
  it("returns a signed URL for a random path inside this org's item folder", async () => {
    const r = await createItemImageUpload("demo", ITEM, "image/png");
    expect(r).toMatchObject({ ok: true, token: "tok", signedUrl: "http://x/sign" });
    const path = (r as { path: string }).path;
    expect(path).toMatch(new RegExp(`^${ORG}/items/${ITEM}/[A-Za-z0-9_-]{16}\\.png$`));
    expect(isMenuImagePath(path)).toBe(true);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(path);
    const second = await createItemImageUpload("demo", ITEM, "image/png");
    expect((second as { path: string }).path).not.toBe(path);
  });
  it("maps the MIME type to the extension and rejects other types", async () => {
    expect(((await createItemImageUpload("demo", ITEM, "image/jpeg")) as { path: string }).path).toMatch(/\.jpg$/);
    expect(((await createItemImageUpload("demo", ITEM, "image/webp")) as { path: string }).path).toMatch(/\.webp$/);
    for (const t of ["image/gif", "image/svg+xml", "application/pdf", "text/html", ""]) {
      expect(await createItemImageUpload("demo", ITEM, t)).toMatchObject({ ok: false });
    }
    expect(storage.createSignedUploadUrl).toHaveBeenCalledTimes(2);
  });
  it("requires menu.manage and an item of this org", async () => {
    perms = ["orders.create"];
    await expect(createItemImageUpload("demo", ITEM, "image/png")).rejects.toBeInstanceOf(Forbidden);
    perms = ["menu.manage"];
    item = null;
    expect(await createItemImageUpload("demo", OTHER_ITEM, "image/png")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await createItemImageUpload("demo", "not-a-uuid", "image/png")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("a Storage error is a generic failure", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "secret detail" } });
    const r = await createItemImageUpload("demo", ITEM, "image/png");
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("setItemImage", () => {
  const fd = (path = GOOD) => form([["itemId", ITEM], ["path", path]]);
  it("sets the path after checking the object exists, and removes the previous object", async () => {
    item = { id: ITEM, image_path: `${ORG}/items/${ITEM}/old_image_1.png` };
    expect(await setItemImage("demo", null, fd())).toEqual({ ok: true });
    expect(updates).toEqual([{ image_path: GOOD }]);
    expect(storage.list).toHaveBeenCalledWith(`${ORG}/items/${ITEM}`, { search: "abcDEF123_-xyz.webp", limit: 5 });
    expect(storage.remove).toHaveBeenCalledWith([`${ORG}/items/${ITEM}/old_image_1.png`]);
    expect(updateTag).toHaveBeenCalledWith(`menu:${ORG}`);
  });
  it("does not remove anything when the item had no image or the same one", async () => {
    await setItemImage("demo", null, fd());
    item = { id: ITEM, image_path: GOOD };
    await setItemImage("demo", null, fd());
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("rejects paths outside this org / item / shape, and writes nothing", async () => {
    const bad = [
      `${OTHER_ORG}/items/${ITEM}/abcDEF123_-xyz.webp`,
      `${ORG}/items/${OTHER_ITEM}/abcDEF123_-xyz.webp`,
      `${ORG}/items/${ITEM}/../${OTHER_ITEM}/x.webp`,
      `${ORG}/items/${ITEM}/a.gif`,
      `${ORG}/items/${ITEM}/a b.webp`,
      `${ORG}/other/${ITEM}/abc.webp`,
      `/${ORG}/items/${ITEM}/abc.webp`,
      `https://evil.test/${ORG}/items/${ITEM}/abc.webp`,
      "",
    ];
    for (const p of bad) expect(await setItemImage("demo", null, fd(p)), p).toMatchObject({ ok: false, fieldErrors: expect.any(Object) });
    expect(updates).toHaveLength(0);
    expect(storage.list).not.toHaveBeenCalled();
  });
  it("rejects a path whose file was never uploaded", async () => {
    storage.list.mockResolvedValue({ data: [], error: null });
    expect(await setItemImage("demo", null, fd())).toMatchObject({ ok: false, fieldErrors: { path: ["Upload the image first."] } });
    expect(updates).toHaveLength(0);
  });
  it("requires menu.manage and an item of this org; maps a database 42501", async () => {
    perms = [];
    await expect(setItemImage("demo", null, fd())).rejects.toBeInstanceOf(Forbidden);
    perms = ["menu.manage"];
    item = null;
    expect(await setItemImage("demo", null, fd())).toMatchObject({ ok: false, code: "FORBIDDEN" });
    item = { id: ITEM, image_path: null };
    updateError = { code: "42501" };
    expect(await setItemImage("demo", null, fd())).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("clearItemImage", () => {
  it("clears the column and removes the object", async () => {
    item = { id: ITEM, image_path: GOOD };
    expect(await clearItemImage("demo", null, form([["itemId", ITEM]]))).toEqual({ ok: true });
    expect(updates).toEqual([{ image_path: null }]);
    expect(storage.remove).toHaveBeenCalledWith([GOOD]);
  });
  it("is forbidden without menu.manage and rejects foreign items", async () => {
    perms = ["kitchen.view"];
    await expect(clearItemImage("demo", null, form([["itemId", ITEM]]))).rejects.toBeInstanceOf(Forbidden);
    perms = ["menu.manage"];
    item = null;
    expect(await clearItemImage("demo", null, form([["itemId", ITEM]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updates).toHaveLength(0);
  });
});

describe("menuImageUrl", () => {
  it("builds the public URL for a valid path, null otherwise", () => {
    expect(menuImageUrl(GOOD)).toBe(`http://127.0.0.1:54321/storage/v1/object/public/menu-images/${ORG}/items/${ITEM}/abcDEF123_-xyz.webp`);
    for (const p of [null, undefined, "", "javascript:alert(1)", `${ORG}/items/${ITEM}/../x.png`, "https://evil.test/a.png"]) expect(menuImageUrl(p)).toBeNull();
  });
});
