import { ResetPasswordPage, authMetadata } from "@/components/auth/pages/pages";

export const generateMetadata = () => authMetadata("en", "reset", "/reset-password");

export default function Page() {
  return <ResetPasswordPage locale="en" />;
}
