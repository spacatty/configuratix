import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Sets --font-sans / --font-mono on <html>; Tailwind's font-sans / font-mono
// (and the `font-data` utility) read these variables.
const fontSans = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  icons: { icon: "/favicon.svg" },
  title: {
    default: "Configuratix",
    template: "%s · Configuratix",
  },
  description: "Proxy server management control plane",
};

export const viewport: Viewport = {
  themeColor: "#0f0d0d",
  colorScheme: "dark",
};

// Read PUBLIC_API_URL per request (runtime env), not at build time.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${fontSans.variable} ${fontMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Runtime backend URL for the browser bundle; empty means "same origin". */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__CFX_API_URL__=${JSON.stringify(process.env.PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(/</g, String.fromCharCode(92) + "u003c")};`,
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
