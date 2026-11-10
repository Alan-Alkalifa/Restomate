import Link from "next/link";
import type { MarketingContent } from "@/app/(frontend)/_content/en";
import { getDemoUrl } from "./demo-url";

export function CtaButtons({ cta }: { cta: MarketingContent["cta"] }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/signup" className="flex min-h-12 items-center rounded-lg bg-teal-700 px-5 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
        {cta.trial}
      </Link>
      <Link href={getDemoUrl()} className="flex min-h-12 items-center rounded-lg px-5 font-semibold ring-1 ring-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:hover:bg-neutral-800">
        {cta.demo}
      </Link>
    </div>
  );
}
