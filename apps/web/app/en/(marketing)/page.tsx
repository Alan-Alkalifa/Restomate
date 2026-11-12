import { HomePage, marketingMetadata } from "@/components/marketing/pages";

export const generateMetadata = () => marketingMetadata("en", "home");

export default function Page() {
  return <HomePage locale="en" />;
}
