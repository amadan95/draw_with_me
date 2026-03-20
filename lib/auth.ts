import { auth } from "@clerk/nextjs/server";

export function isClerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
  );
}

export function isLocalDevAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && !isClerkConfigured();
}

export async function getRequestIdentity() {
  if (isLocalDevAuthBypassEnabled()) {
    return {
      status: "authenticated" as const,
      userId: "local-dev-user"
    };
  }

  if (!isClerkConfigured()) {
    return {
      status: "unconfigured" as const,
      userId: null
    };
  }

  const authObject = await auth();
  return {
    status: authObject.userId ? ("authenticated" as const) : ("anonymous" as const),
    userId: authObject.userId ?? null
  };
}
