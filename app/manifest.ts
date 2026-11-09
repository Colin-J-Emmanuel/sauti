import type { MetadataRoute } from "next";

// "Add to Home Screen" opens Sauti full screen with its own icon, like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sauti: daftari la sauti",
    short_name: "Sauti",
    description: "Speak your sales in Swahili. Sauti keeps the books and bills family abroad through PayPal.",
    start_url: "/",
    display: "standalone",
    background_color: "#1b2650",
    theme_color: "#1b2650",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
