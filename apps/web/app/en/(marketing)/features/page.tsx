import { FeaturesPage, marketingMetadata } from "@/components/marketing/pages";

export const generateMetadata = () => marketingMetadata("en", "features");

export default function Page() {
  return <FeaturesPage locale="en" />;
}
