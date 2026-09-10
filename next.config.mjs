const isProduction = process.env.NODE_ENV === "production";
const isSitesBuild = process.env.BRONTIDE_SITES_BUILD === "1";
const useGithubPagesBasePath = isProduction && process.env.BRONTIDE_LOCAL_BUILD !== "1" && !isSitesBuild;

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  agentRules: false,
  env: { NEXT_PUBLIC_BRONTIDE_LOCAL: process.env.BRONTIDE_LOCAL_BUILD === "1" ? "1" : "0" },
  trailingSlash: true,
  basePath: useGithubPagesBasePath ? "/Journal" : "",
  assetPrefix: useGithubPagesBasePath ? "/Journal/" : "",
  images: { unoptimized: true },
};

export default nextConfig;
