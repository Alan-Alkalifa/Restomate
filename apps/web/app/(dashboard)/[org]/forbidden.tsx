import { ForbiddenNotice } from "@/components/dashboard/notices";

// Used if DAVIN enables `forbidden()` (experimental.authInterrupts).
export default function Forbidden() {
  return <ForbiddenNotice />;
}
