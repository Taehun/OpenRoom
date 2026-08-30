import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const editorial = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-editorial",
});

const ui = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ui",
});

export const metadata: Metadata = {
  title: "Nook",
  description: "The room becomes the storefront.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${editorial.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
