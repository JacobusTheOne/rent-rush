import type { Metadata, Viewport } from "next";
import "@aws-amplify/ui-react/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rent Rush",
  description: "A fast property-trading board game for 2-4 players. Buy streets, collect rent, chase the Jackpot.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10151c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
