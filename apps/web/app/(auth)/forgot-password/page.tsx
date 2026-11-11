import { ForgotPasswordPage, authMetadata } from "@/components/auth/pages/pages";

export const generateMetadata = () => authMetadata("id", "forgot", "/forgot-password");

export default function Page() {
  return <ForgotPasswordPage locale="id" />;
}
