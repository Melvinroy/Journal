const isProduction = process.env.NODE_ENV === "production";

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: isProduction ? "/Journal" : "",
  assetPrefix: isProduction ? "/Journal/" : "",
  images: { unoptimized: true },
};

export default nextConfig;
