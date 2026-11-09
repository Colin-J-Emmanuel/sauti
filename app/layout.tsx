import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Sauti",
  description: "A Swahili voice ledger for corner shops that bills family abroad through PayPal.",
  appleWebApp: { capable: true, title: "Sauti", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#1b2650", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sw">
      <body>
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
