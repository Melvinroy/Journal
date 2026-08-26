import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Journal — Review clearly. Trade deliberately.",
  description: "An open-source, self-hosted trading journal for risk, R-multiple distribution and repeatable execution.",
  openGraph: {
    title: "Trading Journal",
    description: "Open-source, self-hosted trade analytics with private cloud synchronization.",
    images: ["https://trading-journal.melvinroyv.chatgpt.site/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Trading Journal",
    description: "Open-source, self-hosted trade analytics with private cloud synchronization.",
    images: ["https://trading-journal.melvinroyv.chatgpt.site/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
