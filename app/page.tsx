"use client";

import dynamic from "next/dynamic";

// The desktop export ships the standalone route only. Keep cloud auth out
// of its static asset graph.
const CloudHome = process.env.NEXT_PUBLIC_BRONTIDE_STANDALONE_BUILD === "1"
  ? () => null
  : dynamic(() => import("./CloudHome"));

export default function Home() {
  return <CloudHome />;
}
