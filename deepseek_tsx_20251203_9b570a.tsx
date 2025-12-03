import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { TRPCProvider } from '@/lib/trpc/Provider';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/components/auth-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'VarsityHub - University Super App',
  description: 'Your all-in-one digital campus ecosystem',
  keywords: ['university', 'student', 'marketplace', 'events', 'campus'],
  authors: [{ name: 'VarsityHub Team' }],
  creator: 'VarsityHub',
  publisher: 'VarsityHub',
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    locale: 'en_ZA',
    url: 'https://varsityhub.ac.za',
    title: 'VarsityHub - University Super App',
    description: 'Your all-in-one digital campus ecosystem',
    siteName: 'VarsityHub',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VarsityHub - University Super App',
    description: 'Your all-in-one digital campus ecosystem',
    creator: '@varsityhub',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <TRPCProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <AuthProvider>
              {children}
            </AuthProvider>
            <Toaster />
          </ThemeProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}