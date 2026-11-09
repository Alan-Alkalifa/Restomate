import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

let mockState: unknown = null;
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return { ...actual, useActionState: (action: unknown) => [mockState, action, false] };
});

import { ActionDialog } from "./ActionDialog";
import { FieldError } from "./field-errors";

const action = async () => ({ ok: true as const });
const render = (fields?: string[]) =>
  renderToStaticMarkup(
    <ActionDialog label="Invite" title="Invite staff" action={action} submitLabel="Send" fields={fields}>
      <input name="email" defaultValue="typed@x.com" />
      <FieldError name="email" />
    </ActionDialog>,
  );

describe("ActionDialog error rendering (B1-T10)", () => {
  it("shows a fieldErrors-only result (no formError) and keeps the typed value", () => {
    mockState = { ok: false, fieldErrors: { email: ["Enter a valid email."], memberId: ["Member not found."] } };
    const html = render(["email"]);
    expect(html).toContain("Enter a valid email."); // inline, next to the field
    expect(html).toContain("Team member: Member not found."); // no field: summary alert
    expect(html).toContain('value="typed@x.com"');
    expect(html).not.toMatch(/<form[^>]*action=/); // submitted via onSubmit so React never resets the inputs
  });
  it("puts every field error in the summary when no field is claimed", () => {
    mockState = { ok: false, fieldErrors: { allLocations: ["Choose at least one location."] } };
    const html = render();
    expect(html).toContain("Locations: Choose at least one location.");
  });
  it("shows no alert text on success or initial state", () => {
    mockState = null;
    expect(render()).not.toContain("<p class=\"rounded-lg border");
  });
});
