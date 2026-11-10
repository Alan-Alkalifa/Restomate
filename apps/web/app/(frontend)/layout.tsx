import Link from "next/link";
import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of this group (see RootDocument). Marketing is not translated yet: lang stays "en".
export const metadata = defaultMetadata;

export default function FrontendLayout({ children }: LayoutProps<"/">) {
  return (
    <RootDocument lang="en">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold text-teal-700 dark:text-teal-400">Restomate</Link>
          <ul className="flex items-center gap-4 text-sm">
            <li><Link href="/pricing" className="underline-offset-4 hover:underline">Pricing</Link></li>
            <li><Link href="/login" className="underline-offset-4 hover:underline">Sign in</Link></li>
          </ul>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</div>
      <footer className="border-t border-neutral-200 px-4 py-6 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
        © Restomate
      </footer>
    </RootDocument>
  );
}
