import Link from "next/link";

export const SIGNUP_CLOSED_MESSAGE = "Sign-ups are closed right now.";

export function SignupClosed() {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <p className="font-medium">{SIGNUP_CLOSED_MESSAGE}</p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Already have an account? <Link href="/login" className="underline">Sign in</Link>.</p>
    </div>
  );
}
