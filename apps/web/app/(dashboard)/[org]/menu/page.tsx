import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOrgContext } from "@/app/(dashboard)/_data";
import { MenuManager } from "@/components/menu/MenuManager";
import { MenuTabs } from "@/components/menu/MenuTabs";
import * as menu from "@/lib/menu/actions";
import { getMenu } from "@/lib/menu/data";
import { MenuSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Menu · Restomate" };

async function Menu({ params }: { params: PageProps<"/[org]/menu">["params"] }) {
  const { org } = await params;
  const ctx = await requireOrgContext(org);
  const data = await getMenu(ctx.org.slug);
  const slug = ctx.org.slug;
  // The org slug is bound here, on the server. The client never sends an organization id.
  const actions = {
    createCategory: menu.createCategory.bind(null, slug),
    updateCategory: menu.updateCategory.bind(null, slug),
    setCategoryActive: menu.setCategoryActive.bind(null, slug),
    reorderCategories: menu.reorderCategories.bind(null, slug),
    createItem: menu.createItem.bind(null, slug),
    updateItem: menu.updateItem.bind(null, slug),
    setItemActive: menu.setItemActive.bind(null, slug),
    setItemPublished: menu.setItemPublished.bind(null, slug),
    reorderItems: menu.reorderItems.bind(null, slug),
    saveItemVariants: menu.saveItemVariants.bind(null, slug),
    createModifierGroup: menu.createModifierGroup.bind(null, slug),
    updateModifierGroup: menu.updateModifierGroup.bind(null, slug),
    setModifierGroupActive: menu.setModifierGroupActive.bind(null, slug),
    saveGroupModifiers: menu.saveGroupModifiers.bind(null, slug),
    setItemModifierGroups: menu.setItemModifierGroups.bind(null, slug),
  };
  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Menu</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Shared by all locations. Prices are in {data.currency}.</p>
      </header>
      <MenuTabs orgSlug={slug} locationId={ctx.locations[0]?.id ?? null} current="items" canManage={data.canManage} />
      <MenuManager data={data} actions={actions} />
    </main>
  );
}

export default function MenuPage({ params }: PageProps<"/[org]/menu">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <Menu params={params} />
    </Suspense>
  );
}
