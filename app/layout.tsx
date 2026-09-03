import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";

const ui = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-ui",
});

const mono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "OpenRoom",
  description: "AI Room Planner & Furniture Shopping",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
