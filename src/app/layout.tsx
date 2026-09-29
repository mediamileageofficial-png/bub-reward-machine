import type { Metadata, Viewport } from "next";
import "@fontsource/anton/400.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/800.css";
import "./globals.css";
import { bub } from "@/config/bub";

export const metadata: Metadata = {
  title: `${bub.event.name} — Scan. Play. Win.`,
  description: `Pick your BUB box and win at ${bub.event.name}, ${bub.event.datesLabel}, ${bub.event.venue}.`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: bub.brand.colors.background,
};

const c = bub.brand.colors;
/** Brand colours from the central config → CSS variables used by the Tailwind theme. */
const brandVars = `:root{--brand-bg:${c.background};--brand-orange:${c.orange};--brand-black:${c.black};--brand-white:${c.white};--brand-muted:${c.muted};--brand-border:${c.border};--brand-success:${c.success};--brand-danger:${c.danger}}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandVars.replace(/</g, "") }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
