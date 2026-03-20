"use client";

import { ClerkProvider } from "@clerk/nextjs";

const hasClerkKeys = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function RootProviders({
  children
}: {
  children: React.ReactNode;
}) {
  if (!hasClerkKeys) {
    return children;
  }

  return <ClerkProvider>{children}</ClerkProvider>;
}
