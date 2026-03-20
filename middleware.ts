import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isLocalDevAuthBypassEnabled } from "@/lib/auth";

const middleware = isLocalDevAuthBypassEnabled()
  ? (() => NextResponse.next())
  : clerkMiddleware();

export default middleware;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api)(.*)"]
};
