import './globals.css';
import { ReactNode } from 'react';
import { ThemeProvider } from '@/lib/theme';

export const metadata = {
  title: 'LoreStream Engine',
  description: 'Web3 Spatial Computing Agent',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="creator">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
