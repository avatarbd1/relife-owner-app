import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Relife Clinic OS",
    short_name: "Relife",
    description: "Relife Clinic Web App",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#0f172a",
    orientation: "portrait",
    prefer_related_applications: false,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
