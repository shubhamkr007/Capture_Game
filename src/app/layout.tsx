import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Territory Capture Game',
  description: 'A shared real-time grid where players capture territory in short rounds.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
