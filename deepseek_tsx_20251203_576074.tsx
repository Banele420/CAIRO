import DashboardLayout from '@/components/layout/DashboardLayout';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  if (!session) {
    redirect('/login');
  }

  if (!session.user.isOnboarded) {
    redirect('/onboarding');
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}