import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Journal",
  description: "A calm, focused workspace for reviewing trades and building a repeatable edge.",
  openGraph: {
    title: "Trading Journal",
    description: "Review clearly. Trade deliberately.",
    images: ["https://melvinroy.github.io/Journal/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Trading Journal",
    description: "Review clearly. Trade deliberately.",
    images: ["https://melvinroy.github.io/Journal/og.png"],
  },
  icons: { icon: "/Journal/favicon.svg", shortcut: "/Journal/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
