import { Suspense } from "react";
import { SectionPlaceholder } from "@/components/dashboard/SectionPlaceholder";

async function Content({ params }: { params: PageProps<"/[org]/[location]/[section]">["params"] }) {
  const { org, location, section } = await params;
  return <SectionPlaceholder orgSlug={org} locationId={location} section={section} />;
}

export default function LocationSectionPage({ params }: PageProps<"/[org]/[location]/[section]">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}
