import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { signIn } from "../_actions";

export const metadata: Metadata = { title: "Sign in · Restomate" };

const ERRORS: Record<string, string> = {
  link_expired: "That link has expired or was already used. Please try again.",
};

// Only same-site relative paths are accepted as `next` (server re-validates).
function safeNext(v: string | string[] | undefined) {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : undefined;
}

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const code = typeof sp.error === "string" ? sp.error : undefined;
  return <LoginForm action={signIn} next={safeNext(sp.next)} initialError={code ? ERRORS[code] : undefined} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
