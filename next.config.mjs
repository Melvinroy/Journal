const isProduction = process.env.NODE_ENV === "production";

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  env: { NEXT_PUBLIC_BRONTIDE_LOCAL: process.env.BRONTIDE_LOCAL_BUILD === "1" ? "1" : "0" },
  trailingSlash: true,
  basePath: isProduction && process.env.BRONTIDE_LOCAL_BUILD !== "1" ? "/Journal" : "",
  assetPrefix: isProduction && process.env.BRONTIDE_LOCAL_BUILD !== "1" ? "/Journal/" : "",
  images: { unoptimized: true },
};

export default nextConfig;
