import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

const site = "https://www.jev-trade.com";
const title = "Sigma x Hyperliquid | testnet";
const description =
  "Desk do sigma: s = sign(hl2 - EMA24) da H1 fechada, sobre o executor Hyperliquid. Testnet. Nao e um sinal de compra nem prova de edge.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "Sigma x Hyperliquid",
      url: `${site}/`,
      description,
    },
    {
      "@type": "WebApplication",
      name: "Sigma x Hyperliquid",
      url: `${site}/`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description,
      isAccessibleForFree: true,
      codeRepository: "https://github.com/aowang-ai/jev-trade",
    },
    {
      "@type": "SoftwareSourceCode",
      name: "jev-trade",
      url: "https://github.com/aowang-ai/jev-trade",
      codeRepository: "https://github.com/aowang-ai/jev-trade",
      programmingLanguage: "TypeScript",
      license: "https://opensource.org/licenses/MIT",
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title,
  description,
  applicationName: "Sigma x Hyperliquid",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png" }],
  },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "Sigma x Hyperliquid",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1e9cf" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1a17" },
  ],
  viewportFit: "cover",
};

/**
 * Resolve o tema antes da primeira pintura: escolha gravada > preferencia do
 * sistema > claro. Vai por `next/script` com `beforeInteractive` (o mecanismo
 * documentado para o App Router): um `<script>` solto dentro da arvore React
 * nao e executado no cliente e a consola acusa-o.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plex.variable} suppressHydrationWarning>
      <head>
        <link rel="describedby" href="https://www.jev-trade.com/llms.txt" />
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {children}
      </body>
    </html>
  );
}
