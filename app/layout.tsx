import type { Metadata } from "next";
import SettingsMenu from "@/components/SettingsMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "StreamMatch — find tonight's watch",
  description:
    "An entertainment concierge that matches the newest & most popular streaming content to exactly how you feel right now.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <SettingsMenu />
        {children}
      </body>
    </html>
  );
}
