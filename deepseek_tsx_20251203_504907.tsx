'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingBag,
  MapPin,
  Calendar,
  Briefcase,
  BookOpen,
  MessageSquare,
  Music,
  Search,
  Bell,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { WebSocketProvider } from '@/components/websocket-provider';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
  { icon: ShoppingBag, label: 'Marketplace', href: '/marketplace' },
  { icon: MapPin, label: 'Campus Map', href: '/campus-map' },
  { icon: Calendar, label: 'Events', href: '/events' },
  { icon: Briefcase, label: 'Career Zone', href: '/career' },
  { icon: BookOpen, label: 'Study Hub', href: '/study-hub' },
  { icon: MessageSquare, label: 'Forum', href: '/forum' },
  { icon: Music, label: 'Music & Creative', href: '/music' },
  { icon: Search, label: 'Lost & Found', href: '/lost-found' },
  { icon: MessageSquare, label: 'Messages', href: '/messages' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  return (
    <WebSocketProvider>
      <div className="min-h-screen bg-background">
        {/* Mobile header */}
        <header className="sticky top-0 z-50 flex h-16 items-center gap-4 border-b bg-background px-4 md:hidden">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col">
              <nav className="grid gap-2 text-lg font-medium">
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 text-lg font-semibold"
                  onClick={() => setSidebarOpen(false)}
                >
                  <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                    <span className="text-primary-foreground font-bold">V</span>
                  </div>
                  <span>VarsityHub</span>
                </Link>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground',
                        isActive && 'bg-muted text-foreground'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="mt-auto">
                <UserDropdown user={user} logout={logout} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">
              {navItems.find((item) => item.href === pathname)?.label || 'Dashboard'}
            </h1>
          </div>
          <NotificationBell count={unreadCount} />
        </header>

        {/* Desktop sidebar */}
        <div className="hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
          <div className="flex min-h-0 flex-1 flex-col border-r bg-background">
            <div className="flex h-16 shrink-0 items-center border-b px-4">
              <Link href="/dashboard" className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-bold">V</span>
                </div>
                <span className="text-lg font-semibold">VarsityHub</span>
              </Link>
            </div>
            <nav className="flex-1 space-y-1 p-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t p-4">
              <UserDropdown user={user} logout={logout} />
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="md:pl-64">
          <main className="min-h-screen">
            <div className="p-4 md:p-6">{children}</div>
          </main>
        </div>
      </div>
    </WebSocketProvider>
  );
}

function UserDropdown({ user, logout }: { user: any; logout: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.avatarUrl} />
            <AvatarFallback>
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="ml-2 flex-1 text-left">
            <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.email || 'student@ufs4life.ac.za'}
            </p>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        {user?.hasStudentBusiness && (
          <DropdownMenuItem asChild>
            <Link href="/seller-dashboard">Seller Dashboard</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationBell({ count }: { count: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {count > 9 ? '9+' : count}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between p-2">
          <h3 className="font-semibold">Notifications</h3>
          <Button variant="ghost" size="sm" className="text-xs">
            Mark all read
          </Button>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {/* Notifications will be populated here */}
          <div className="p-4 text-center text-sm text-muted-foreground">
            No notifications
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}