import type { MetadataRoute } from "next";
import { siteUrl } from "../landing/site-url";

/** Lets every crawler read the site, and tells it where the sitemap is. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}
