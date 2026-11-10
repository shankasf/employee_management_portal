import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { CookieBanner } from "@/components/CookieBanner";

// PERFORMANCE: Use font-display: swap for faster text rendering
// This shows fallback font immediately while custom fonts load
const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
  preload: true,
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "PlayFunia Employee Portal",
  description: "Employee Management Portal for PlayFunia Indoor Playground",
  applicationName: "PlayFunia",
  appleWebApp: {
    capable: true,
    title: "PlayFunia",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var K='chunk_reload',M=3,W=30000;function ok(){try{var r=sessionStorage.getItem(K),n=Date.now();if(r){var d=JSON.parse(r);if(n-d.t>W){sessionStorage.setItem(K,JSON.stringify({c:1,t:n}));return true}if(d.c>=M)return false;sessionStorage.setItem(K,JSON.stringify({c:d.c+1,t:d.t}));return true}sessionStorage.setItem(K,JSON.stringify({c:1,t:n}));return true}catch(e){return false}}function isChunk(err){return err&&(err.name==='ChunkLoadError'||(err.message&&(err.message.indexOf('Loading chunk')!==-1||err.message.indexOf('dynamically imported module')!==-1||err.message.indexOf('Failed to fetch')!==-1)))}document.addEventListener('error',function(e){var t=e.target;if(!t)return;var tag=t.tagName&&t.tagName.toLowerCase();if((tag==='script'||tag==='link')&&(t.src||t.href||'').indexOf('/_next/')!==-1&&ok()){window.location.reload()}},true);window.addEventListener('error',function(e){if(isChunk(e.error)&&ok())window.location.reload()});window.addEventListener('unhandledrejection',function(e){if(isChunk(e.reason)&&ok())window.location.reload()})})();` }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          {children}
          <CookieBanner />
        </AuthProvider>
      </body>
    </html>
  );
}
