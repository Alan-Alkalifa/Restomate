import { Suspense } from "react";
import { BannerForm, OwnedOrgCapForm, SignupForm, TaxPresetsForm } from "@/components/admin/SettingsForms";
import { getPlatformSettings } from "@/lib/admin/platform-settings";
import { updateMaintenanceBanner, updateOwnedOrgCap, updateSignup, updateTaxPresets } from "@/lib/admin/settings-actions";
import { requirePlatformAdmin } from "../../_data";

async function Settings() {
  await requirePlatformAdmin(); // pages re-check; the layout guard is not the only protection
  const s = await getPlatformSettings();
  return (
    <div className="flex flex-col gap-6">
      <SignupForm action={updateSignup} initial={s.signup} />
      <BannerForm action={updateMaintenanceBanner} initial={s.maintenanceBanner} />
      <TaxPresetsForm action={updateTaxPresets} initial={s.taxPresets} />
      <OwnedOrgCapForm action={updateOwnedOrgCap} initial={s.ownedOrgCap} />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Suspense fallback={<div role="status" aria-label="Loading settings" className="flex flex-col gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-40 max-w-2xl animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />)}</div>}>
        <Settings />
      </Suspense>
    </main>
  );
}
