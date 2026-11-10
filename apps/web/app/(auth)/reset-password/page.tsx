import { ResetPasswordPage, authMetadata } from "@/components/auth/pages/pages";

export const generateMetadata = () => authMetadata("id", "reset", "/reset-password");

export default function Page() {
  return <ResetPasswordPage locale="id" />;
}
