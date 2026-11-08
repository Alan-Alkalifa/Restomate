import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/SignupForm";
import { signUp } from "../_actions";

export const metadata: Metadata = { title: "Create account · Restomate" };

// Only same-site relative paths are accepted as `next` (the server re-validates).
function safeNext(v: string | string[] | undefined) {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : undefined;
}

async function SignupContent({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const sp = await searchParams;
  return <SignupForm action={signUp} next={safeNext(sp.next)} />;
}

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />}>
        <SignupContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
