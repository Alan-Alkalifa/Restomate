import { SignupPage, authMetadata } from "@/components/auth/pages/pages";

export const generateMetadata = () => authMetadata("en", "signup", "/signup");

export default function Page({ searchParams }: PageProps<"/en/signup">) {
  return <SignupPage locale="en" searchParams={searchParams} />;
}
