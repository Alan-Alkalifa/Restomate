import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";
import StaffInvite, { type StaffInviteProps } from "./StaffInvite";

const base: StaffInviteProps = {
  restaurantName: "Warung Maju",
  inviterName: "Sari",
  roleName: "Manager",
  locationNames: ["Kemang", "Senopati"],
  acceptUrl: "https://app.restomate.app/invite/accept?token=abc",
  expiresAt: "2026-12-01T10:00:00.000Z",
};

describe("StaffInvite", () => {
  it("renders without logo or brand colour using defaults", async () => {
    const html = await render(<StaffInvite {...base} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("#0f766e");
    expect(html).toContain("Warung Maju");
    expect(html).toContain("Kemang, Senopati");
  });

  it("renders logo and brand colour when given", async () => {
    const html = await render(
      <StaffInvite {...base} logoUrl="https://cdn.example.com/l.png" brandColor="#d97706" />,
    );
    expect(html).toContain("https://cdn.example.com/l.png");
    expect(html).toContain("#d97706");
  });

  it("ignores an invalid brand colour", async () => {
    const html = await render(<StaffInvite {...base} brandColor="red;x" />);
    expect(html).not.toContain("red;x");
    expect(html).toContain("#0f766e");
  });

  it("shows the accept link as button and text, plus expiry", async () => {
    const html = await render(<StaffInvite {...base} />);
    expect(html.split(base.acceptUrl).length - 1).toBeGreaterThanOrEqual(2);
    expect(html).toContain("1 December 2026");
  });

  it("has a readable plain-text version", async () => {
    const text = await render(<StaffInvite {...base} />, { plainText: true });
    expect(text).toContain(base.acceptUrl);
    expect(text).toContain("Manager");
  });

  it("handles no inviter, no locations and long names", async () => {
    const html = await render(
      <StaffInvite {...base} inviterName={null} locationNames={[]} restaurantName={"X".repeat(200)} />,
    );
    expect(html).toContain("All locations");
    expect(html).toContain("You&#x27;ve been invited");
  });
});
