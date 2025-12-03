'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Wallet, 
  ArrowUpDown, 
  QrCode, 
  Building, 
  Smartphone, 
  Zap,
  History,
  Plus,
  Send,
  Download,
  CreditCard,
  BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { FundWalletModal } from './FundWalletModal';
import { SendMoneyModal } from './SendMoneyModal';
import { WithdrawModal } from './WithdrawModal';
import { BillPaymentModal } from './BillPaymentModal';
import { QRCodeModal } from './QRCodeModal';
import { TransactionHistory } from './TransactionHistory';
import { WalletStats } from './WalletStats';

export default function WalletDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [showFundModal, setShowFundModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);

  const { data: wallet, isLoading, refetch } = trpc.wallet.getWallet.useQuery();
  const { data: stats } = trpc.wallet.getWalletStats.useQuery();

  const quickActions = [
    {
      icon: Plus,
      label: 'Add Money',
      color: 'bg-green-500',
      onClick: () => setShowFundModal(true),
    },
    {
      icon: Send,
      label: 'Send Money',
      color: 'bg-blue-500',
      onClick: () => setShowSendModal(true),
    },
    {
      icon: Download,
      label: 'Withdraw',
      color: 'bg-purple-500',
      onClick: () => setShowWithdrawModal(true),
    },
    {
      icon: QrCode,
      label: 'QR Pay',
      color: 'bg-orange-500',
      onClick: () => setShowQRModal(true),
    },
    {
      icon: Smartphone,
      label: 'Airtime',
      color: 'bg-red-500',
      onClick: () => setShowBillModal(true),
    },
    {
      icon: Zap,
      label: 'Electricity',
      color: 'bg-yellow-500',
      onClick: () => router.push('/wallet/bills?type=electricity'),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!wallet) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <Wallet className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Wallet Found</h3>
          <p className="text-gray-600 mb-4">You need to set up your wallet first</p>
          <Button onClick={() => router.push('/wallet/setup')}>
            Set Up Wallet
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Wallet Balance Card */}
      <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-6 w-6" />
              VarsityHub Wallet
            </div>
            <Badge variant="secondary" className="bg-white/20 text-white">
              {wallet.isVerified ? 'Verified' : 'Unverified'}
            </Badge>
          </CardTitle>
          <CardDescription className="text-blue-100">
            Available Balance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">
                {formatCurrency(wallet.availableBalance / 100)}
              </span>
              <span className="text-blue-200">ZAR</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-blue-200">Total Balance</p>
                <p className="font-semibold">{formatCurrency(wallet.balance / 100)}</p>
              </div>
              <div>
                <p className="text-blue-200">Daily Limit</p>
                <p className="font-semibold">
                  {formatCurrency((wallet.stats.dailyLimitRemaining || 0) / 100)} remaining
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Fast access to wallet features</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {quickActions.map((action, idx) => {
              const Icon = action.icon;
              return (
                <Button
                  key={idx}
                  variant="outline"
                  className="flex flex-col items-center justify-center h-24 gap-3 hover:bg-gray-50"
                  onClick={action.onClick}
                >
                  <div className={`${action.color} p-3 rounded-full`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-sm font-medium">{action.label}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4">
          <TabsTrigger value="overview">
            <BarChart3 className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="transactions">
            <History className="h-4 w-4 mr-2" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="merchants">
            <Building className="h-4 w-4 mr-2" />
            Campus Merchants
          </TabsTrigger>
          <TabsTrigger value="cards">
            <CreditCard className="h-4 w-4 mr-2" />
            Cards & Banks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <WalletStats stats={stats} />
          
          {/* Recent Transactions Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
              <CardDescription>Latest wallet activity</CardDescription>
            </CardHeader>
            <CardContent>
              <TransactionHistory preview={true} />
            </CardContent>
          </Card>

          {/* Campus Offers */}
          <Card className="bg-gradient-to-r from-green-50 to-blue-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg mb-2">Campus Cashback</h3>
                  <p className="text-gray-600">
                    Get 5% cashback when you pay with VarsityHub Wallet at campus merchants
                  </p>
                </div>
                <Badge className="bg-green-100 text-green-700">
                  Active
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <TransactionHistory preview={false} />
        </TabsContent>

        <TabsContent value="merchants">
          <CampusMerchants />
        </TabsContent>

        <TabsContent value="cards">
          <CardsAndBanks />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <FundWalletModal 
        open={showFundModal} 
        onClose={() => setShowFundModal(false)} 
        onSuccess={refetch}
      />
      <SendMoneyModal 
        open={showSendModal} 
        onClose={() => setShowSendModal(false)} 
        onSuccess={refetch}
      />
      <WithdrawModal 
        open={showWithdrawModal} 
        onClose={() => setShowWithdrawModal(false)} 
        onSuccess={refetch}
      />
      <BillPaymentModal 
        open={showBillModal} 
        onClose={() => setShowBillModal(false)} 
        onSuccess={refetch}
      />
      <QRCodeModal 
        open={showQRModal} 
        onClose={() => setShowQRModal(false)}
      />
    </div>
  );
}

function CampusMerchants() {
  const { data: merchants, isLoading } = trpc.wallet.getCampusMerchants.useQuery();

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campus Merchants</CardTitle>
        <CardDescription>Pay with wallet at these campus businesses</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {merchants?.map((merchant) => (
            <Card key={merchant.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {merchant.logoUrl ? (
                    <img 
                      src={merchant.logoUrl} 
                      alt={merchant.businessName}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Building className="h-6 w-6 text-blue-600" />
                    </div>
                  )}
                  <div className="flex-1">
                    <h4 className="font-semibold">{merchant.businessName}</h4>
                    <p className="text-sm text-gray-600">{merchant.businessType}</p>
                    <p className="text-xs text-gray-500 mt-1">{merchant.user.campus}</p>
                  </div>
                  <Button size="sm" variant="outline">Pay</Button>
                </div>
                {merchant.description && (
                  <p className="text-sm text-gray-600 mt-3">{merchant.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CardsAndBanks() {
  const { data: banks, isLoading } = trpc.wallet.getBanks.useQuery();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Linked Banks</CardTitle>
          <CardDescription>Bank accounts for withdrawals</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : banks?.length === 0 ? (
            <div className="text-center py-8">
              <Building className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No bank accounts linked</p>
              <Button className="mt-4">Add Bank Account</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {banks?.map((bank) => (
                <div key={bank.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <Building className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold">{bank.bankName}</h4>
                      <p className="text-sm text-gray-600">
                        {bank.accountNumber} • {bank.accountName}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {bank.isDefault && (
                          <Badge variant="outline" className="text-xs">
                            Default
                          </Badge>
                        )}
                        {bank.isVerified && (
                          <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                            Verified
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">Edit</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Cards</CardTitle>
          <CardDescription>Cards for quick deposits</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <CreditCard className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">No cards saved yet</p>
            <Button className="mt-4" variant="outline">Add Card</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}