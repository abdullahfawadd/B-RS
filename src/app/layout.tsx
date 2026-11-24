import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backup & Recovery System",
  description: "Manage file backups, verify integrity, and test recovery from real archives.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={GeistSans.variable}><body>{children}</body></html>;
}
