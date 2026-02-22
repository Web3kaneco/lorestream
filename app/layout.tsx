import './globals.css';
import { ReactNode } from 'react';

export const metadata = {
  title: 'LoreStream Engine',
  description: 'Web3 Spatial Computing Agent',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}