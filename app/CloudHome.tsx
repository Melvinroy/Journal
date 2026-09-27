"use client";

import dynamic from "next/dynamic";
import WorkspaceApp from "./WorkspaceApp";
import type { CloudComponents } from "./WorkspaceApp";
import { cloudTradeGateway } from "../lib/cloud-trade-gateway";

const cloudComponents: CloudComponents = {
  AuthScreen: dynamic(() => import("./CloudAccess").then(module => module.AuthScreen)),
  SetupScreen: dynamic(() => import("./CloudAccess").then(module => module.SetupScreen)),
  CatalystDashboard: dynamic(() => import("./CatalystDashboard").then(module => module.CatalystDashboard)),
  ScannerDashboard: dynamic(() => import("./ScannerDashboard").then(module => module.ScannerDashboard)),
  ResearchWorkspace: dynamic(() => import("./ResearchWorkspace").then(module => module.ResearchWorkspace)),
  ChartDashboard: dynamic(() => import("./ChartDashboard").then(module => module.ChartDashboard)),
};

export default function CloudHome() {
  return <WorkspaceApp cloud={cloudTradeGateway} cloudComponents={cloudComponents} />;
}
