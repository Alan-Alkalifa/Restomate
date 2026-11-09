import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/app/(dashboard)/_data";
import { signOut } from "@/app/(auth)/_actions";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { AcceptInvitationForm } from "@/components/staff/AcceptInvitationForm";
import { emailMatchesHint } from "@/components/staff/invite-email";
import { acceptInvitation, getInvitationPreview } from "@/lib/staff/actions";

// The token is a secret in the URL: never send it as a Referrer, never index the page.
export const metadata: Metadata = {
  title: "Join a restaurant · Restomate",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Invalid() {
  return (
    <div role="alert" className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">This invitation link isn&apos;t valid</h1>
      <p className="text-sm">It may have expired, been revoked, or already been used. Ask the restaurant to send you a new invitation.</p>
      <Link href="/login" className="text-sm underline">Go to sign in</Link>
    </div>
  );
}

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  const preview = await getInvitationPreview(token);
  // One generic page for invalid, expired, revoked, used and unknown tokens.
  if (!preview || preview.expired) return <Invalid />;

  const user = await getCurrentUser();
  const next = encodeURIComponent(`/invite/${token}`);
  const intro = (
    <>
      <h1 className="text-xl font-semibold break-words">Join {preview.restaurantName}</h1>
      <p className="text-sm">You&apos;ve been invited as <strong>{preview.roleName}</strong> ({preview.emailHint}).</p>
    </>
  );
  const btn = "flex min-h-12 items-center justify-center rounded-lg px-5 font-semibold";

  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        {intro}
        <p className="text-sm">Sign in or create an account with the invited email address to accept.</p>
        <Link href={`/login?next=${next}`} className={`${btn} bg-teal-700 text-white`}>Sign in</Link>
        <Link href={`/signup?next=${next}`} className={`${btn} ring-1 ring-neutral-400`}>Create account</Link>
      </div>
    );
  }
  if (!emailMatchesHint(user.email, preview.emailHint)) {
    return (
      <div role="alert" className="flex flex-col gap-4">
        {intro}
        <p className="text-sm">You&apos;re signed in as a different account than the one invited ({preview.emailHint}). Sign out and sign in with the invited address to accept.</p>
        <SignOutButton action={signOut} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {intro}
      <AcceptInvitationForm action={acceptInvitation} token={token} />
    </div>
  );
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-48 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
      <Invite params={params} />
    </Suspense>
  );
}
