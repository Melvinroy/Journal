"use client";

import { ChartDashboard } from "../ChartDashboard";

// Public sample route in Pages builds; same-origin EOD route in local builds.
export default function ChartsPage() {
  return <ChartDashboard onExit={() => { window.location.href = "../"; }}/>;
}
