import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false },
};

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10 sm:px-6">
      <p className="text-2xl font-semibold tracking-tight text-teal-700 dark:text-teal-400">Restomate</p>
      {children}
    </main>
  );
}
