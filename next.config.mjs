const isProduction = process.env.NODE_ENV === "production";

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: isProduction ? "/Brontide" : "",
  assetPrefix: isProduction ? "/Brontide/" : "",
  images: { unoptimized: true },
};

export default nextConfig;
