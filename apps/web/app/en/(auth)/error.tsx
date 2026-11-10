"use client";

import { AuthError } from "@/components/auth/AuthError";

export default function Error({ retry }: { error: Error; retry: () => void }) {
  return <AuthError locale="en" retry={retry} />;
}
