import type { Metadata } from "next";
import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Question Paper Solver",
  description:
    "Upload any question paper PDF and get step-by-step AI solutions with crisp equations, diagrams, and elegant formatting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
