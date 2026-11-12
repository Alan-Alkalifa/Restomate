import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/dal", () => ({ requireOrgContext: vi.fn(), requirePermission: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/venue/shared", () => ({ assertLocation: vi.fn() }));

import { joinTableLabels } from "./data";

describe("joinTableLabels", () => {
  it("a single table prints as is", () => expect(joinTableLabels(["T4"])).toBe("T4"));
  it("a group prints sorted by label, e.g. T4 + T5", () => expect(joinTableLabels(["T5", "T4"])).toBe("T4 + T5"));
  it("sorts numerically, not alphabetically (T2 + T10)", () => expect(joinTableLabels(["T10", "T2"])).toBe("T2 + T10"));
  it("ignores duplicates", () => expect(joinTableLabels(["T4", "T4", "T5"])).toBe("T4 + T5"));
  it("no tables (takeaway) is null", () => expect(joinTableLabels([])).toBeNull());
});
