'use client';

import { useState } from 'react';
import { Wallet, CreditCard, Building, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface PaymentOptionsProps {
  productId: number;
  productTitle: string;
  amount: number; // in cents
  sellerId: number;
  onSuccess: () => void;
}

export function PaymentOptions({ productId, productTitle, amount, sellerId, onSuccess }: PaymentOptionsProps) {
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'card' | 'qr'>('wallet');
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pin, setPin] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const { data: wallet } = trpc.wallet.getWallet.useQuery();
  const payWithWallet = trpc.wallet.payMerchant.useMutation();
  const sendMessage = trpc.messaging.send.useMutation();

  const handleWalletPayment = async () => {
    if (!wallet) {
      toast({
        title: 'Wallet Required',
        description: 'Please set up your wallet first',
        variant: 'destructive',
      });
      return;
    }

    if (amount > wallet.availableBalance) {
      toast({
        title: 'Insufficient Balance',
        description: `You need ${formatCurrency(amount / 100)} but only have ${formatCurrency(wallet.availableBalance / 100)}`,
        variant: 'destructive',
      });
      return;
    }

    setShowPinDialog(true);
  };

  const confirmPayment = async () => {
    if (pin.length !== 4 || !/^\d+$/.test(pin)) {
      toast({
        title: 'Invalid PIN',
        description: 'Please enter a valid 4-digit PIN',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    try {
      // First, create conversation with seller
      const conversation = await sendMessage.mutateAsync({
        receiverId: sellerId,
        content: `I want to purchase "${productTitle}" for ${formatCurrency(amount / 100)}. Please confirm availability.`,
      });

      // Then process payment
      const payment = await payWithWallet.mutateAsync({
        merchantId: sellerId,
        amount,
        pin,
        description: `Purchase: ${productTitle}`,
      });

      // Send payment confirmation message
      await sendMessage.mutateAsync({
        conversationId: conversation.conversationId,
        content: `Payment confirmed. Transaction reference: ${payment.reference}. Please arrange delivery.`,
      });

      toast({
        title: 'Payment Successful',
        description: `You've paid ${formatCurrency(amount / 100)} for ${productTitle}`,
      });

      setShowPinDialog(false);
      setPin('');
      onSuccess();
    } catch (error: any) {
      toast({
        title: 'Payment Failed',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Payment Options</CardTitle>
          <CardDescription>Choose how you want to pay</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Payment Method Selection */}
          <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
            <div className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <RadioGroupItem value="wallet" id="wallet" />
              <div className="flex-1 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-blue-600" />
                  <div>
                    <Label htmlFor="wallet" className="font-medium cursor-pointer">
                      VarsityHub Wallet
                    </Label>
                    <p className="text-sm text-gray-500">
                      Pay instantly with your wallet balance
                    </p>
                  </div>
                </div>
                {wallet && (
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(wallet.availableBalance / 100)}</p>
                    <p className="text-sm text-gray-500">Available</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <RadioGroupItem value="card" id="card" />
              <div className="flex-1 flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-purple-600" />
                <div>
                  <Label htmlFor="card" className="font-medium cursor-pointer">
                    Card Payment
                  </Label>
                  <p className="text-sm text-gray-500">
                    Pay with Visa, Mastercard, or Verve
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
              <RadioGroupItem value="qr" id="qr" />
              <div className="flex-1 flex items-center gap-3">
                <QrCode className="h-5 w-5 text-green-600" />
                <div>
                  <Label htmlFor="qr" className="font-medium cursor-pointer">
                    QR Code Payment
                  </Label>
                  <p className="text-sm text-gray-500">
                    Scan seller's QR code to pay
                  </p>
                </div>
              </div>
            </div>
          </RadioGroup>

          {/* Payment Summary */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Product Price</span>
              <span className="font-medium">{formatCurrency(amount / 100)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="text-red-600">-{formatCurrency((amount * 0.015) / 100)}</span>
            </div>
            <div className="flex justify-between border-t pt-3">
              <span className="font-semibold">Total Amount</span>
              <span className="font-bold text-lg">
                {formatCurrency((amount + amount * 0.015) / 100)}
              </span>
            </div>
          </div>

          {/* Action Button */}
          <Button 
            className="w-full" 
            size="lg"
            onClick={handleWalletPayment}
            disabled={isProcessing || !wallet}
          >
            {isProcessing ? (
              'Processing...'
            ) : (
              <>
                <Wallet className="h-5 w-5 mr-2" />
                Pay with Wallet
              </>
            )}
          </Button>

          <p className="text-xs text-center text-gray-500">
            By completing this purchase, you agree to our Terms of Service
          </p>
        </CardContent>
      </Card>

      {/* PIN Dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Wallet PIN</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-600">
              Please enter your 4-digit wallet PIN to confirm payment of{' '}
              <span className="font-semibold">{formatCurrency(amount / 100)}</span>
            </p>
            <div className="space-y-2">
              <Label htmlFor="pin">Wallet PIN</Label>
              <Input
                id="pin"
                type="password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 4-digit PIN"
                className="text-center text-2xl tracking-widest"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmPayment} disabled={pin.length !== 4 || isProcessing}>
              {isProcessing ? 'Processing...' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}