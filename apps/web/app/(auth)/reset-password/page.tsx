import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { updatePassword } from "../_actions";

export const metadata: Metadata = { title: "Reset password · Restomate" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <ResetPasswordForm action={updatePassword} />
    </>
  );
}
