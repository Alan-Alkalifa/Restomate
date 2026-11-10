// All marketing copy lives here so Bahasa Indonesia can be added as `id.ts` (same `MarketingContent`
// shape) without touching components. No plan prices or limits belong in this file: link to /pricing.

export type MarketingLink = { label: string; href: string };

export type ModuleKey = "pos" | "kds" | "qr" | "reservations" | "reports";

export type FeatureModule = {
  key: ModuleKey;
  title: string;
  summary: string;
  /** Used on the Features page. */
  points: string[];
};

export type MarketingContent = {
  brand: string;
  nav: {
    ariaLabel: string;
    features: string;
    pricing: string;
    demo: string;
    login: string;
    signup: string;
  };
  footer: {
    ariaLabel: string;
    tagline: string;
    productHeading: string;
    accountHeading: string;
    copyright: string;
  };
  cta: { trial: string; demo: string; seeFeatures: string; seePricing: string };
  home: {
    metaTitle: string;
    metaDescription: string;
    heroTitle: string;
    heroBody: string;
    modulesHeading: string;
    modulesIntro: string;
    closingTitle: string;
    closingBody: string;
  };
  features: {
    metaTitle: string;
    metaDescription: string;
    title: string;
    intro: string;
    closingTitle: string;
    closingBody: string;
  };
  modules: FeatureModule[];
};

export const en: MarketingContent = {
  brand: "Restomate",
  nav: {
    ariaLabel: "Main",
    features: "Features",
    pricing: "Pricing",
    demo: "Demo",
    login: "Log in",
    signup: "Sign up",
  },
  footer: {
    ariaLabel: "Footer",
    tagline: "Restaurant management, POS and ordering in one dashboard.",
    productHeading: "Product",
    accountHeading: "Account",
    copyright: "Restomate. All rights reserved.",
  },
  cta: {
    trial: "Start free trial",
    demo: "See the demo",
    seeFeatures: "See all features",
    seePricing: "View pricing",
  },
  home: {
    metaTitle: "Restomate: run your whole restaurant from one dashboard",
    metaDescription:
      "POS, kitchen display, QR table ordering, reservations and reports for restaurants in Indonesia. Start with a free trial.",
    heroTitle: "Run your whole restaurant from one dashboard.",
    heroBody:
      "POS, orders, kitchen, tables, reservations and reports, plus a branded ordering site with QR codes for your guests.",
    modulesHeading: "Everything service needs",
    modulesIntro: "One system for the front of house, the kitchen and the back office.",
    closingTitle: "Ready to try it?",
    closingBody: "Set up your restaurant in minutes. Compare plans on the pricing page.",
  },
  features: {
    metaTitle: "Features · Restomate",
    metaDescription:
      "Explore the Restomate POS, kitchen display, QR ordering, reservations and reports.",
    title: "Features",
    intro: "Each module works on its own and shares the same menu, tables and staff.",
    closingTitle: "See it in action",
    closingBody: "Open the demo restaurant, or start a free trial of your own.",
  },
  modules: [
    {
      key: "pos",
      title: "Point of sale",
      summary: "Take dine-in and takeaway orders fast, on any touch screen.",
      points: [
        "Touch-first layout with large buttons",
        "Split and partial payments",
        "Cash, card and online payment, including QRIS",
        "Printable bills for 80mm and 58mm paper",
      ],
    },
    {
      key: "kds",
      title: "Kitchen display",
      summary: "Orders reach the kitchen the moment they are placed.",
      points: [
        "Live tickets that update without refreshing",
        "Move tickets from new to ready with one tap",
        "Reconnects on its own after a Wi-Fi drop",
      ],
    },
    {
      key: "qr",
      title: "QR ordering",
      summary: "Guests scan the code on the table and order from their phone.",
      points: [
        "A branded ordering site for your restaurant",
        "One QR code per table, rotated whenever you need",
        "Prices and availability always come from your menu",
      ],
    },
    {
      key: "reservations",
      title: "Reservations",
      summary: "Keep bookings and tables in step.",
      points: [
        "Time slots by party size and area",
        "Confirm, seat and track no-shows",
        "Table status updates as guests arrive and leave",
      ],
    },
    {
      key: "reports",
      title: "Reports",
      summary: "See how the restaurant is doing, by day, hour, item or branch.",
      points: [
        "Sales by day, hour, item and category",
        "Payment method mix and outstanding bills",
        "Staff performance and table turnover",
        "Export to CSV",
      ],
    },
  ],
};

export const content: MarketingContent = en;
