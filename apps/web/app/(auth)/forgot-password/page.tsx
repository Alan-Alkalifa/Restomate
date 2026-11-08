import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { requestPasswordReset } from "../_actions";

export const metadata: Metadata = { title: "Forgot password · Restomate" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Forgot your password?</h1>
      <p className="text-sm">Enter your email and we&apos;ll send you a link to reset it.</p>
      <ForgotPasswordForm action={requestPasswordReset} />
    </>
  );
}
