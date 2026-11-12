import { PricingPage, marketingMetadata } from "@/components/marketing/pages";

export const generateMetadata = () => marketingMetadata("id", "pricing");

export default function Page() {
  return <PricingPage locale="id" />;
}
