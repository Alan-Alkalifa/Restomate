import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { updatePassword } from "@/lib/auth/actions";
import { passwordHint } from "@/components/auth/password-hint";

export const metadata: Metadata = { title: "Reset password · Restomate" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <ResetPasswordForm action={updatePassword} passwordHint={passwordHint()} />
    </>
  );
}
