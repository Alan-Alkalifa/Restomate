import { expect, it } from "vitest";
import { memberTag, orgTag } from "./tags";

it("builds id-only tags", () => {
  expect(orgTag("o-1")).toBe("org:o-1");
  expect(memberTag("u-1", "o-1")).toBe("member:u-1:o-1");
});
