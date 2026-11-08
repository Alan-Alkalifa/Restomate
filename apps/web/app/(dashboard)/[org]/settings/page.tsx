import { Suspense } from "react";
import { SectionPlaceholder } from "@/components/dashboard/SectionPlaceholder";

async function Content({ params }: { params: PageProps<"/[org]/settings">["params"] }) {
  const { org } = await params;
  return <SectionPlaceholder orgSlug={org} section="settings" />;
}

export default function Page({ params }: PageProps<"/[org]/settings">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}
