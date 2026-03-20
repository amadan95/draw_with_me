"use client";

import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton
} from "@clerk/nextjs";

const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function AuthControls() {
  if (!hasClerk) {
    return (
      <div className="draw-auth-chip draw-auth-chip--warning">Local AI</div>
    );
  }

  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="draw-auth-chip" type="button">
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <div className="draw-auth-user">
          <span className="draw-auth-chip">Signed in</span>
          <UserButton
            appearance={{
              elements: {
                avatarBox: "draw-auth-avatar"
              }
            }}
          />
        </div>
      </SignedIn>
    </>
  );
}
