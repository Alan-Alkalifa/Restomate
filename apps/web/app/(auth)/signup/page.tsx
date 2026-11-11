import { SignupPage, authMetadata } from "@/components/auth/pages/pages";

export const generateMetadata = () => authMetadata("id", "signup", "/signup");

export default function Page({ searchParams }: PageProps<"/signup">) {
  return <SignupPage locale="id" searchParams={searchParams} />;
}
