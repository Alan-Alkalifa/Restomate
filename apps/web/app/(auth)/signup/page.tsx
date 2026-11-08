import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/SignupForm";
import { signUp } from "../_actions";

export const metadata: Metadata = { title: "Create account · Restomate" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <SignupForm action={signUp} />
    </>
  );
}
