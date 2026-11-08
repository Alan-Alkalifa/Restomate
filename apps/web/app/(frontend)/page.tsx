import Link from "next/link";

// Demo storefront: subdomain in production, path-based locally.
const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
const demoUrl = root && !root.startsWith("localhost") ? `https://demo.${root}` : "/s/demo";

export default function HomePage() {
  return (
    <main className="flex flex-col items-start gap-6 py-10">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
        Run your whole restaurant from one dashboard.
      </h1>
      <p className="max-w-xl text-lg text-neutral-700 dark:text-neutral-300">
        POS, orders, kitchen, tables, reservations and reports, plus a branded ordering site with QR codes for your guests.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/signup" className="flex min-h-12 items-center rounded-lg bg-teal-700 px-5 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
          Start free trial
        </Link>
        <Link href={demoUrl} className="flex min-h-12 items-center rounded-lg px-5 font-semibold ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          See the demo restaurant
        </Link>
      </div>
    </main>
  );
}
