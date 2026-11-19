import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RouteBook",
  description: "Van-sales stock and customer account management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
