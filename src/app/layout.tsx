import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterServiceWorker } from '@/components/RegisterServiceWorker';

export const metadata: Metadata = {
  title: 'Restro POS — Billing',
  description: 'Restaurant billing, kitchen tickets and daily sales tracking.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Restro POS',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Restro POS' },
  /**
   * iOS does not read the web manifest's icons. Without an explicit
   * `apple-touch-icon` link it puts a *screenshot of the page* on the home
   * screen, which is the difference between something that looks like an app and
   * something that looks like a saved bookmark. The 180×180 file has always been
   * in /public/icons; nothing referenced it.
   */
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    /**
     * Next emits the modern `mobile-web-app-capable`, which iOS honours from
     * 16.4. The old name is what an older iPhone reads to launch the home-screen
     * icon full-screen instead of dropping it into a Safari tab, and it costs one
     * line to support both.
     */
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // The billing screen is a fixed workspace; pinch-zooming it on a counter
  // tablet only ever happens by accident.
  userScalable: false,
  themeColor: '#0E5C63',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
