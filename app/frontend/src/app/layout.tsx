import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "COUNTDOWN // DEGEN AUCTION",
  description: "Last ticket wins the vault. Are you degen enough?",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <div className="noise-bg" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
