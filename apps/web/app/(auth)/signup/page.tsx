import type { Metadata } from "next";
import { Suspense } from "react";
import { passwordHint } from "@/components/auth/password-hint";
import { SignupForm } from "@/components/auth/SignupForm";
import { signUp } from "@/lib/auth/actions";
import { sanitizeNext } from "@/lib/auth/redirect";

/** `next` reaches the hidden input only after the shared sanitiser; the action re-validates it. */
const nextParam = (v: string | string[] | undefined) => (typeof v === "string" ? sanitizeNext(v, "") || undefined : undefined);

export const metadata: Metadata = { title: "Create account · Restomate" };

async function SignupContent({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const sp = await searchParams;
  return <SignupForm action={signUp} passwordHint={passwordHint()} next={nextParam(sp.next)} />;
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
