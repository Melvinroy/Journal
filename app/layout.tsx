import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brontide — Review clearly. Trade deliberately.",
  description: "An open-source trading system for catalyst intelligence, charting, risk-aware execution and post-trade learning.",
  openGraph: {
    title: "Brontide",
    description: "Open-source, self-hosted trade analytics with private cloud synchronization.",
    images: ["https://brontide.melvinroyv.chatgpt.site/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Brontide",
    description: "Open-source, self-hosted trade analytics with private cloud synchronization.",
    images: ["https://brontide.melvinroyv.chatgpt.site/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
