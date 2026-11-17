import type { Metadata } from "next";
import "./globals.css";
import AvisoCookies from '@/components/AvisoCookies';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "APPCAR",
  description: "Gestão financeira do seu trabalho",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}<div className="links-legais"><Link href="/privacidade">Privacidade</Link><Link href="/cookies">Cookies e armazenamento</Link></div><AvisoCookies /></body>
    </html>
  );
}
