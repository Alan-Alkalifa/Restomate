import { FeaturesPage, marketingMetadata } from "@/components/marketing/pages";

export const generateMetadata = () => marketingMetadata("id", "features");

export default function Page() {
  return <FeaturesPage locale="id" />;
}
