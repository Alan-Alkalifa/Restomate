import { Suspense } from "react";
import { SectionPlaceholder } from "@/components/dashboard/SectionPlaceholder";

async function Content({ params }: { params: PageProps<"/[org]/customers">["params"] }) {
  const { org } = await params;
  return <SectionPlaceholder orgSlug={org} section="customers" />;
}

export default function Page({ params }: PageProps<"/[org]/customers">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}
