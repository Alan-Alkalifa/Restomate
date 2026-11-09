// TEMPORARY SEAM (MSS-T09). Mirrors docs/contracts/platform-settings.md (types, constants, defaults only).
// DAVIN's MSS-T08 module replaces this file and adds the Zod schemas. Delete this seam when it merges.
export type BannerLevel = "info" | "warning";
export type MaintenanceBanner = { enabled: boolean; message: string; level: BannerLevel };
export type TaxPreset = {
  code: string;
  label: string;
  taxRateBps: number;
  serviceChargeBps: number;
  taxOnServiceCharge: boolean;
};
export type PlatformSettings = {
  signup: { enabled: boolean };
  maintenanceBanner: MaintenanceBanner;
  taxPresets: { presets: TaxPreset[]; defaultCode: string };
  ownedOrgCap: { max: number };
};

export const BANNER_MESSAGE_MAX = 200;
export const TAX_PRESETS_MAX = 20;
export const OWNED_ORG_CAP_RANGE = { min: 1, max: 100 } as const;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  signup: { enabled: true },
  maintenanceBanner: { enabled: false, message: "", level: "info" },
  taxPresets: {
    presets: [
      { code: "pb1_10", label: "PB1 10%", taxRateBps: 1000, serviceChargeBps: 0, taxOnServiceCharge: true },
      { code: "pb1_10_sc5", label: "PB1 10% + service 5%", taxRateBps: 1000, serviceChargeBps: 500, taxOnServiceCharge: true },
    ],
    defaultCode: "pb1_10",
  },
  ownedOrgCap: { max: 3 },
};
