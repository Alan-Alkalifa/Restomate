import { LoginPage, authMetadata } from "@/components/auth/pages/pages";

export const generateMetadata = () => authMetadata("id", "login", "/login");

export default function Page({ searchParams }: PageProps<"/login">) {
  return <LoginPage locale="id" searchParams={searchParams} />;
}
