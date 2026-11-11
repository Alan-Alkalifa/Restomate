import { PricingPage, marketingMetadata } from "@/components/marketing/pages";

export const generateMetadata = () => marketingMetadata("en", "pricing");

export default function Page() {
  return <PricingPage locale="en" />;
}
