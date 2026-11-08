import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type StaffInviteProps = {
  restaurantName: string;
  inviterName: string | null;
  roleName: string;
  locationNames: string[];
  acceptUrl: string;
  /** ISO 8601 timestamp */
  expiresAt: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  /** IANA time zone used to display the expiry. Defaults to Asia/Jakarta. */
  timeZone?: string;
};

/** All user-facing copy lives here so Bahasa Indonesia can be added in M1. */
export const staffInviteCopy = {
  en: {
    preview: (restaurant: string) => `You're invited to join ${restaurant} on Restomate`,
    heading: (restaurant: string) => `Join ${restaurant}`,
    intro: (inviter: string | null, restaurant: string, role: string) =>
      inviter
        ? `${inviter} invited you to join ${restaurant} on Restomate as ${role}.`
        : `You've been invited to join ${restaurant} on Restomate as ${role}.`,
    locations: "Locations",
    allLocations: "All locations",
    cta: "Accept invitation",
    linkHint: "Or copy and paste this link into your browser:",
    expires: (date: string) => `This invitation expires on ${date}.`,
    ignore: "If you weren't expecting this, you can safely ignore this email.",
    footer: "Sent by Restomate",
  },
} as const;

const DEFAULT_BRAND = "#0f766e";

function safeColor(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_BRAND;
}

export const DEFAULT_TIME_ZONE = "Asia/Jakarta";

export function formatExpiry(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone, timeZoneName: "short" }).format(d);
  } catch {
    // Invalid time zone name: fall back to the default.
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: DEFAULT_TIME_ZONE, timeZoneName: "short" }).format(d);
  }
}

export default function StaffInvite({
  restaurantName,
  inviterName,
  roleName,
  locationNames,
  acceptUrl,
  expiresAt,
  logoUrl,
  brandColor,
  timeZone,
}: StaffInviteProps) {
  const t = staffInviteCopy.en;
  const color = safeColor(brandColor);

  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>{t.preview(restaurantName)}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          {logoUrl ? (
            <Img
              src={logoUrl}
              alt={restaurantName}
              height={48}
              style={styles.logo}
            />
          ) : null}
          <Heading as="h1" style={{ ...styles.h1, color }}>
            {t.heading(restaurantName)}
          </Heading>
          <Text style={styles.text}>
            {t.intro(inviterName, restaurantName, roleName)}
          </Text>
          <Section style={styles.locations}>
            <Text style={styles.label}>{t.locations}</Text>
            <Text style={styles.text}>
              {locationNames.length > 0
                ? locationNames.join(", ")
                : t.allLocations}
            </Text>
          </Section>
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button
              href={acceptUrl}
              style={{ ...styles.button, backgroundColor: color }}
            >
              {t.cta}
            </Button>
          </Section>
          <Text style={styles.small}>{t.linkHint}</Text>
          <Text style={styles.link}>
            <Link href={acceptUrl} style={{ color }}>
              {acceptUrl}
            </Link>
          </Text>
          <Text style={styles.small}>{t.expires(formatExpiry(expiresAt, timeZone))}</Text>
          <Text style={styles.small}>{t.ignore}</Text>
          <Text style={styles.footer}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

StaffInvite.PreviewProps = {
  restaurantName: "Demo Restaurant",
  inviterName: "Sari Wulandari",
  roleName: "Cashier",
  locationNames: ["Kemang", "Senopati"],
  acceptUrl: "https://app.restomate.app/invite/accept?token=preview",
  expiresAt: "2026-12-01T10:00:00.000Z",
  logoUrl: null,
  brandColor: null,
} satisfies StaffInviteProps;

const styles = {
  body: {
    backgroundColor: "#f4f4f5",
    fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    margin: 0,
    padding: "24px 0",
  },
  container: {
    backgroundColor: "#ffffff",
    maxWidth: "520px",
    margin: "0 auto",
    padding: "32px",
    borderRadius: "8px",
  },
  logo: { display: "block", marginBottom: "16px", objectFit: "contain" as const },
  h1: { fontSize: "22px", lineHeight: "28px", margin: "0 0 16px", wordBreak: "break-word" as const },
  text: { fontSize: "15px", lineHeight: "22px", color: "#27272a", margin: "0 0 8px", wordBreak: "break-word" as const },
  label: { fontSize: "12px", textTransform: "uppercase" as const, color: "#71717a", margin: "0 0 4px" },
  locations: { margin: "16px 0 0" },
  button: {
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: 600,
    padding: "12px 24px",
    borderRadius: "6px",
    textDecoration: "none",
  },
  small: { fontSize: "13px", lineHeight: "20px", color: "#52525b", margin: "0 0 8px" },
  link: { fontSize: "13px", lineHeight: "20px", margin: "0 0 16px", wordBreak: "break-all" as const },
  footer: { fontSize: "12px", color: "#a1a1aa", marginTop: "24px" },
};
