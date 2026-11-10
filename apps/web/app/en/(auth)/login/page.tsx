import { LoginPage, authMetadata } from "@/components/auth/pages/pages";

export const generateMetadata = () => authMetadata("en", "login", "/login");

export default function Page({ searchParams }: PageProps<"/en/login">) {
  return <LoginPage locale="en" searchParams={searchParams} />;
}
