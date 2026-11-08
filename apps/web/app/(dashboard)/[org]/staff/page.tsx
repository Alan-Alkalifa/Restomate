import { Suspense } from "react";
import { SectionPlaceholder } from "@/components/dashboard/SectionPlaceholder";

async function Content({ params }: { params: PageProps<"/[org]/staff">["params"] }) {
  const { org } = await params;
  return <SectionPlaceholder orgSlug={org} section="staff" />;
}

export default function Page({ params }: PageProps<"/[org]/staff">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}
