import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Roboto, Roboto_Mono } from "next/font/google";
import { SceneStoreProvider } from "../src/features/scene/scene-context";
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
      <body>
        {/*
          One Scene store per browser tab. The layout outlives every route, so
          a soft navigation between `/` and `/demo` remounts the workspace
          against the same store instead of handing the reader a fresh room.
        */}
        <SceneStoreProvider>{children}</SceneStoreProvider>
      </body>
    </html>
  );
}
