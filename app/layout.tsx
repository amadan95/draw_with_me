import type { Metadata } from "next";
import { RootProviders } from "@/components/root-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draw With Me",
  description: "A collaborative draw-with-AI canvas built with Gemini."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
