import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n/dictionaries";
import { publicEnv } from "@/lib/env";
import { vercelPreviewHosts } from "@/lib/routing/host";
import { getStorefront } from "@/lib/storefront/get-storefront";
import { HoursBlock } from "./HoursBlock";
import { LocationPicker } from "./LocationPicker";
import { MenuView } from "./MenuView";
import { StorefrontShell } from "./StorefrontShell";
import { StorefrontUnavailable } from "./StorefrontUnavailable";
import { storefrontBase, storefrontHref } from "./links";
import { getLocationInfo, getPublicMenu, withIds } from "./seam";
import { storefrontCssVars } from "./theme";

/*
 * One page component per language, shared by the Bahasa route (app/(storefront)/s/[tenant]) and the English one
 * (app/(storefront-en)/s/[tenant]/en), so the two trees cannot drift. Server component: read inside <Suspense>.
 * The public menu is browsable without any session; nothing here reads cookies or the user.
 */
type Params = Promise<{ tenant: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Locale = "id" | "en";

export async function storefrontMetadata(locale: Locale, params: Params): Promise<Metadata> {
  const { tenant } = await params;
  const sf = await getStorefront(tenant).catch(() => null);
  if (!sf || sf.status !== "active") return { title: "Restomate", robots: { index: false } };
  const t = (await getDictionary(locale)).storefront;
  // Indexable on purpose (the public menu is the restaurant's shop window); no noindex here.
  return { title: `${sf.name} · ${t.menu.heading}`, description: sf.locations.map((l) => l.name).join(" · ") || sf.name };
}

export async function StorefrontPage({ locale, params, searchParams }: { locale: Locale; params: Params; searchParams: SearchParams }) {
  const [{ tenant }, sp] = await Promise.all([params, searchParams]);
  const t = (await getDictionary(locale)).storefront;
  const sf = await getStorefront(tenant);
  if (!sf) notFound(); // an unknown slug
  if (sf.status === "unavailable") return <StorefrontUnavailable t={t} />;

  // Links depend on how the guest arrived: the tenant's own host ("/", "/en") or by path ("/s/demo", "/s/demo/en").
  const host = (await headers()).get("host");
  const base = storefrontBase(host, sf.slug, { rootDomain: publicEnv.NEXT_PUBLIC_ROOT_DOMAIN, allowLocalhost: process.env.NODE_ENV !== "production", previewHosts: vercelPreviewHosts(process.env) });
  const locations = withIds(sf.locations);
  const wanted = typeof sp.location === "string" ? sp.location : undefined;
  // One location: no picker. Several: the picker until one is chosen (an unknown id just shows the picker, never an error).
  const chosen = locations.length === 1 ? locations[0] : locations.find((l) => l.id === wanted);
  const other = locale === "id" ? "en" : "id";
  const languageHref = storefrontHref(base, other, chosen && locations.length > 1 ? { location: chosen.id } : {});

  let body: React.ReactNode;
  if (!chosen) {
    body = <LocationPicker locations={locations} base={base} locale={locale} t={t} />;
  } else {
    const [menu, info] = await Promise.all([getPublicMenu(sf.slug, chosen.id), getLocationInfo(sf.slug, chosen.id, locations)]);
    if (!menu || !info) notFound(); // an inactive location or one of another tenant looks the same as an unknown one
    body = (
      <>
        <div className="mb-4 flex flex-col gap-3">
          <div>
            <h2 className="text-2xl font-bold break-words">{chosen.name}</h2>
            {chosen.address || chosen.city ? <p className="text-neutral-700">{[chosen.address, chosen.city].filter(Boolean).join(", ")}</p> : null}
            {locations.length > 1 ? <a href={storefrontHref(base, locale)} className="inline-flex min-h-12 items-center underline">{t.locations.change}</a> : null}
          </div>
          <HoursBlock info={info} now={new Date()} t={t} />
        </div>
        <MenuView t={t} tenant={sf.slug} location={{ id: chosen.id, name: chosen.name }} menu={menu} info={info} />
      </>
    );
  }

  return (
    <StorefrontShell name={sf.name} logoUrl={sf.branding.logoUrl} cssVars={storefrontCssVars(sf.branding)} locale={locale} t={t} languageHref={languageHref}>
      {body}
    </StorefrontShell>
  );
}
