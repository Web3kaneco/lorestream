import './globals.css';
import { ReactNode } from 'react';
import { ThemeProvider } from '@/lib/theme';

export const metadata = {
  title: 'LXXI — Seventy-One',
  description: 'Voice is for Vibe, Screen is for Substance',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="prime">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
