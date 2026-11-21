import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PO Assistant",
  description: "Open source demo: a purchase order AI assistant over fake ERP data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold">
              PO Assistant <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">fake data</span>
            </Link>
            <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">Chat</Link>
              <Link href="/logs" className="hover:text-zinc-900 dark:hover:text-zinc-100">Logs</Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4">{children}</main>
      </body>
    </html>
  );
}
