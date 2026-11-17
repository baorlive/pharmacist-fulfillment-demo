import type { Metadata } from 'next';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import './tokens/foundation.css';
import './tokens/semantic.css';
import './tokens/component.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'RxFlow — Orders',
};

const rawClarityId = process.env.NEXT_PUBLIC_CLARITY_ID?.trim() ?? '';
const clarityId = /^[a-zA-Z0-9_-]+$/.test(rawClarityId) ? rawClarityId : '';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@100;400;500;600;700;800&family=DM+Sans:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        {children}
        <Analytics />
        {clarityId ? (
          <Script
            id="ms-clarity"
            strategy="afterInteractive"
            src={`https://www.clarity.ms/tag/${clarityId}`}
          />
        ) : null}
      </body>
    </html>
  );
}
