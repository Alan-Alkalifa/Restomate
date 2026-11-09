import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { content } from "../_content/en";

// Static shell: no session, cookies or headers are read here.
export default function FrontendLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <MarketingHeader content={content} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</div>
      <MarketingFooter content={content} />
    </>
  );
}
