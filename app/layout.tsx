import type { Metadata, Viewport } from "next";
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
  description: "AI room planner and furniture shopping",
  applicationName: "OpenRoom",
  appleWebApp: {
    capable: true,
    title: "OpenRoom",
    statusBarStyle: "default",
  },
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    apple: { url: "/apple-icon.png", type: "image/png", sizes: "180x180" },
    other: [
      {
        rel: "mask-icon",
        url: "/icons/openroom-mask-icon.svg",
        color: "#4B6543",
      },
    ],
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#4B6543",
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
