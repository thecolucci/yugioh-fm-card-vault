import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yu-Gi-Oh! FM — Card Vault",
  description: "Visualizador dos 722 cards de Yu-Gi-Oh! Forbidden Memories com Passwords e custos em Starchips.",
  icons: {
    icon: "/game-assets/icon_eye_millenium.png",
    shortcut: "/game-assets/icon_eye_millenium.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
