// app/layout.tsx
import { AuthProvider } from '@/contexts/AuthContext';
import { DataProvider } from '@/contexts/DataContext';
import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'BIZMAP - Business Mapping Tool',
  description: 'Visualize and analyze your service business data.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <DataProvider>  {/* Add this line */}
            {children}
          </DataProvider> {/* Add this line */}
        </AuthProvider>
      </body>
    </html>
  );
}
