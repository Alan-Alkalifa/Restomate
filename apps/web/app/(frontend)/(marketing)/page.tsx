import { HomePage, marketingMetadata } from "@/components/marketing/pages";

export const generateMetadata = () => marketingMetadata("id", "home");

export default function Page() {
  return <HomePage locale="id" />;
}
