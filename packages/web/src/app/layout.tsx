import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Falkon", description: "Self-hosted code search and Ask" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <strong>Falkon</strong>
          <nav>
            <Link href="/">Search</Link>
            <Link href="/ask">Ask</Link>
            <Link href="/knowledge">Knowledge</Link>
            <Link href="/repos">Repos</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
