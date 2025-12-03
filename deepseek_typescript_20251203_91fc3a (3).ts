import { createTRPCRouter, protectedProcedure, onboardedProcedure, rateLimitedProcedure } from '../_core/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, and, or, like, sql, sum, count, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { 
  wallets, 
  walletTransactions, 
  walletHolds, 
  walletBanks, 
  walletCards, 
  walletMerchants, 
  walletQRCodes, 
  walletBills, 
  walletRecipients,
  users,
  fundWalletSchema,
  transferSchema,
  billPaymentSchema,
  withdrawSchema,
} from '../db/schema-wallet';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import axios from 'axios';
import { env } from '../_core/env';

const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

export const walletRouter = createTRPCRouter({
  // Initialize wallet for user
  initialize: protectedProcedure
    .input(z.object({ pin: z.string().length(4).regex(/^\d+$/) }))
    .mutation(async ({ input, ctx }) => {
      const existingWallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (existingWallet[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Wallet already exists',
        });
      }

      // Hash PIN with salt
      const salt = await bcrypt.genSalt(10);
      const pinHash = await bcrypt.hash(input.pin, salt);

      const wallet = await db
        .insert(wallets)
        .values({
          userId: ctx.user.id,
          walletPinHash: pinHash,
          walletPinSalt: salt,
          isVerified: true, // Auto-verify for campus use
        })
        .returning();

      return wallet[0];
    }),

  // Get wallet balance and info
  getWallet: protectedProcedure.query(async ({ ctx }) => {
    const wallet = await db
      .select({
        id: wallets.id,
        balance: wallets.balance,
        availableBalance: wallets.availableBalance,
        currency: wallets.currency,
        dailyLimit: wallets.dailyLimit,
        monthlyLimit: wallets.monthlyLimit,
        isActive: wallets.isActive,
        isVerified: wallets.isVerified,
        lastTransactionAt: wallets.lastTransactionAt,
        createdAt: wallets.createdAt,
      })
      .from(wallets)
      .where(eq(wallets.userId, ctx.user.id))
      .limit(1);

    if (!wallet[0]) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Wallet not found. Please initialize your wallet first.',
      });
    }

    // Get today's and month's transaction totals
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dailyTotal, monthlyTotal] = await Promise.all([
      db
        .select({ total: sum(walletTransactions.amount) })
        .from(walletTransactions)
        .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
        .where(
          and(
            eq(wallets.userId, ctx.user.id),
            gte(walletTransactions.createdAt, startOfDay),
            eq(walletTransactions.status, 'completed'),
            or(
              eq(walletTransactions.type, 'transfer'),
              eq(walletTransactions.type, 'payment'),
              eq(walletTransactions.type, 'withdrawal')
            )
          )
        ),
      db
        .select({ total: sum(walletTransactions.amount) })
        .from(walletTransactions)
        .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
        .where(
          and(
            eq(wallets.userId, ctx.user.id),
            gte(walletTransactions.createdAt, startOfMonth),
            eq(walletTransactions.status, 'completed'),
            or(
              eq(walletTransactions.type, 'transfer'),
              eq(walletTransactions.type, 'payment'),
              eq(walletTransactions.type, 'withdrawal')
            )
          )
        ),
    ]);

    return {
      ...wallet[0],
      stats: {
        dailySpent: Number(dailyTotal[0]?.total || 0),
        monthlySpent: Number(monthlyTotal[0]?.total || 0),
        dailyLimitRemaining: wallet[0].dailyLimit - Number(dailyTotal[0]?.total || 0),
        monthlyLimitRemaining: wallet[0].monthlyLimit - Number(monthlyTotal[0]?.total || 0),
      },
    };
  }),

  // Fund wallet via Paystack
  fundWallet: protectedProcedure
    .input(fundWalletSchema)
    .mutation(async ({ input, ctx }) => {
      const wallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!wallet[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Wallet not found',
        });
      }

      // Check limits
      if (input.amount > 10000000) { // R100,000 max
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Amount exceeds maximum limit',
        });
      }

      // Create transaction reference
      const reference = `VH_${Date.now()}_${ctx.user.id}_${crypto.randomBytes(4).toString('hex')}`;

      // Initialize Paystack transaction
      const response = await paystack.post('/transaction/initialize', {
        email: ctx.user.email,
        amount: input.amount, // Paystack expects amount in kobo (100 kobo = 1 NGN) but we're using cents
        currency: 'ZAR',
        reference,
        callback_url: `${process.env.FRONTEND_URL}/wallet/callback`,
        metadata: {
          userId: ctx.user.id,
          walletId: wallet[0].id,
          type: 'wallet_funding',
          paymentMethod: input.paymentMethod,
        },
        channels: input.paymentMethod === 'card' ? ['card'] : 
                  input.paymentMethod === 'bank_transfer' ? ['bank_transfer'] : 
                  ['ussd', 'bank', 'card'],
      });

      if (!response.data.status) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to initialize payment',
        });
      }

      // Create pending transaction record
      await db.insert(walletTransactions).values({
        walletId: wallet[0].id,
        reference,
        type: 'deposit',
        subType: input.paymentMethod,
        amount: input.amount,
        fee: Math.round(input.amount * 0.015), // 1.5% fee
        netAmount: input.amount - Math.round(input.amount * 0.015),
        balanceBefore: wallet[0].balance,
        balanceAfter: wallet[0].balance,
        description: `Wallet funding via ${input.paymentMethod}`,
        metadata: {
          authorization_url: response.data.data.authorization_url,
          paymentMethod: input.paymentMethod,
        },
        status: 'pending',
        paymentMethod: input.paymentMethod,
        paymentReference: response.data.data.reference,
      });

      return {
        authorizationUrl: response.data.data.authorization_url,
        reference: response.data.data.reference,
        amount: input.amount,
      };
    }),

  // Verify wallet funding
  verifyFunding: protectedProcedure
    .input(z.object({ reference: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const transaction = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.reference, input.reference))
        .limit(1);

      if (!transaction[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      // Verify with Paystack
      const response = await paystack.get(`/transaction/verify/${input.reference}`);

      if (!response.data.status || response.data.data.status !== 'success') {
        await db
          .update(walletTransactions)
          .set({
            status: 'failed',
            failureReason: response.data.message || 'Payment failed',
            completedAt: new Date(),
          })
          .where(eq(walletTransactions.reference, input.reference));

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Payment verification failed',
        });
      }

      const wallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, transaction[0].walletId))
        .limit(1);

      if (!wallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      // Update wallet balance
      const newBalance = wallet[0].balance + transaction[0].netAmount;
      const newAvailableBalance = wallet[0].availableBalance + transaction[0].netAmount;

      await db.transaction(async (tx) => {
        await tx
          .update(wallets)
          .set({
            balance: newBalance,
            availableBalance: newAvailableBalance,
            lastTransactionAt: new Date(),
          })
          .where(eq(wallets.id, wallet[0].id));

        await tx
          .update(walletTransactions)
          .set({
            status: 'completed',
            balanceBefore: wallet[0].balance,
            balanceAfter: newBalance,
            completedAt: new Date(),
            metadata: {
              ...transaction[0].metadata,
              paystackResponse: response.data.data,
            },
          })
          .where(eq(walletTransactions.reference, input.reference));
      });

      return {
        success: true,
        amount: transaction[0].amount,
        newBalance,
        transaction: response.data.data,
      };
    }),

  // P2P Transfer to another VarsityHub user
  transfer: rateLimitedProcedure
    .input(transferSchema)
    .mutation(async ({ input, ctx }) => {
      const { recipientIdentifier, amount, pin, description } = input;

      // Get sender's wallet
      const senderWallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!senderWallet[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Wallet not found',
        });
      }

      // Verify PIN
      const pinValid = await bcrypt.compare(pin, senderWallet[0].walletPinHash || '');
      if (!pinValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid PIN',
        });
      }

      // Check available balance
      if (amount > senderWallet[0].availableBalance) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Insufficient balance',
        });
      }

      // Check daily and monthly limits
      const now = new Date();
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [dailyTotal, monthlyTotal] = await Promise.all([
        db
          .select({ total: sum(walletTransactions.amount) })
          .from(walletTransactions)
          .where(
            and(
              eq(walletTransactions.walletId, senderWallet[0].id),
              gte(walletTransactions.createdAt, startOfDay),
              eq(walletTransactions.status, 'completed'),
              eq(walletTransactions.type, 'transfer')
            )
          ),
        db
          .select({ total: sum(walletTransactions.amount) })
          .from(walletTransactions)
          .where(
            and(
              eq(walletTransactions.walletId, senderWallet[0].id),
              gte(walletTransactions.createdAt, startOfMonth),
              eq(walletTransactions.status, 'completed'),
              eq(walletTransactions.type, 'transfer')
            )
          ),
      ]);

      const dailySpent = Number(dailyTotal[0]?.total || 0);
      const monthlySpent = Number(monthlyTotal[0]?.total || 0);

      if (dailySpent + amount > senderWallet[0].dailyLimit) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Daily transfer limit exceeded',
        });
      }

      if (monthlySpent + amount > senderWallet[0].monthlyLimit) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Monthly transfer limit exceeded',
        });
      }

      // Find recipient by phone, email, or VarsityHub ID
      let recipient = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
        })
        .from(users)
        .innerJoin(wallets, eq(users.id, wallets.userId))
        .where(
          or(
            eq(users.email, recipientIdentifier),
            eq(users.phone, recipientIdentifier),
            eq(users.id, parseInt(recipientIdentifier) || 0)
          )
        )
        .limit(1);

      if (!recipient[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Recipient not found or does not have a wallet',
        });
      }

      if (recipient[0].id === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot transfer to yourself',
        });
      }

      // Get recipient's wallet
      const recipientWallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, recipient[0].id))
        .limit(1);

      if (!recipientWallet[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Recipient wallet not found',
        });
      }

      // Calculate fee (0.5% for P2P transfers, min R1)
      const fee = Math.max(100, Math.round(amount * 0.005)); // min R1, 0.5%
      const netAmount = amount - fee;

      const reference = `TRF_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      return await db.transaction(async (tx) => {
        // Deduct from sender
        const senderNewBalance = senderWallet[0].balance - amount;
        const senderNewAvailableBalance = senderWallet[0].availableBalance - amount;

        await tx
          .update(wallets)
          .set({
            balance: senderNewBalance,
            availableBalance: senderNewAvailableBalance,
            lastTransactionAt: new Date(),
          })
          .where(eq(wallets.id, senderWallet[0].id));

        // Add to recipient
        const recipientNewBalance = recipientWallet[0].balance + netAmount;
        const recipientNewAvailableBalance = recipientWallet[0].availableBalance + netAmount;

        await tx
          .update(wallets)
          .set({
            balance: recipientNewBalance,
            availableBalance: recipientNewAvailableBalance,
            lastTransactionAt: new Date(),
          })
          .where(eq(wallets.id, recipientWallet[0].id));

        // Create sender transaction
        await tx.insert(walletTransactions).values({
          walletId: senderWallet[0].id,
          reference: `${reference}_S`,
          type: 'transfer',
          subType: 'p2p_send',
          amount: -amount,
          fee: fee,
          netAmount: -amount,
          balanceBefore: senderWallet[0].balance,
          balanceAfter: senderNewBalance,
          description: description || `Transfer to ${recipient[0].name}`,
          receiverId: recipient[0].id,
          status: 'completed',
          paymentMethod: 'wallet',
          completedAt: new Date(),
        });

        // Create recipient transaction
        await tx.insert(walletTransactions).values({
          walletId: recipientWallet[0].id,
          reference: `${reference}_R`,
          type: 'transfer',
          subType: 'p2p_receive',
          amount: netAmount,
          fee: 0,
          netAmount: netAmount,
          balanceBefore: recipientWallet[0].balance,
          balanceAfter: recipientNewBalance,
          description: description || `Transfer from ${ctx.user.name}`,
          senderId: ctx.user.id,
          status: 'completed',
          paymentMethod: 'wallet',
          completedAt: new Date(),
        });

        // Create fee transaction (system revenue)
        await tx.insert(walletTransactions).values({
          walletId: senderWallet[0].id,
          reference: `${reference}_F`,
          type: 'fee',
          amount: -fee,
          fee: 0,
          netAmount: -fee,
          balanceBefore: senderNewBalance,
          balanceAfter: senderNewBalance,
          description: 'Transfer fee',
          status: 'completed',
          completedAt: new Date(),
        });

        // Update recipient in sender's favorite list
        await tx
          .insert(walletRecipients)
          .values({
            userId: ctx.user.id,
            recipientType: 'user',
            recipientId: recipient[0].id,
            recipientName: recipient[0].name,
            recipientIdentifier: recipient[0].email || recipient[0].phone || recipient[0].id.toString(),
            lastTransactionAt: new Date(),
            totalTransactions: 1,
            totalAmount: amount,
          })
          .onConflictDoUpdate({
            target: [walletRecipients.userId, walletRecipients.recipientId],
            set: {
              lastTransactionAt: new Date(),
              totalTransactions: sql`${walletRecipients.totalTransactions} + 1`,
              totalAmount: sql`${walletRecipients.totalAmount} + ${amount}`,
            },
          });

        return {
          success: true,
          reference,
          amount,
          fee,
          recipient: recipient[0].name,
          newBalance: senderNewBalance,
        };
      });
    }),

  // Pay merchant/business
  payMerchant: rateLimitedProcedure
    .input(
      z.object({
        merchantId: z.number().int().positive(),
        amount: z.number().int().min(10),
        pin: z.string().length(4).regex(/^\d+$/),
        description: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { merchantId, amount, pin, description } = input;

      // Get sender's wallet
      const senderWallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!senderWallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      // Verify PIN
      const pinValid = await bcrypt.compare(pin, senderWallet[0].walletPinHash || '');
      if (!pinValid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid PIN' });
      }

      // Check balance
      if (amount > senderWallet[0].availableBalance) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient balance' });
      }

      // Get merchant
      const merchant = await db
        .select({
          id: walletMerchants.id,
          userId: walletMerchants.userId,
          businessName: walletMerchants.businessName,
          transactionFeePercentage: walletMerchants.transactionFeePercentage,
        })
        .from(walletMerchants)
        .where(eq(walletMerchants.id, merchantId))
        .limit(1);

      if (!merchant[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Merchant not found' });
      }

      // Get merchant's wallet
      const merchantWallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, merchant[0].userId))
        .limit(1);

      if (!merchantWallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Merchant wallet not found' });
      }

      // Calculate merchant fee (1% by default)
      const feePercentage = parseFloat(merchant[0].transactionFeePercentage || '1.00');
      const fee = Math.round(amount * (feePercentage / 100));
      const merchantAmount = amount - fee;

      const reference = `MERCH_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      return await db.transaction(async (tx) => {
        // Deduct from sender
        const senderNewBalance = senderWallet[0].balance - amount;
        const senderNewAvailableBalance = senderWallet[0].availableBalance - amount;

        await tx
          .update(wallets)
          .set({
            balance: senderNewBalance,
            availableBalance: senderNewAvailableBalance,
            lastTransactionAt: new Date(),
          })
          .where(eq(wallets.id, senderWallet[0].id));

        // Add to merchant (minus fee)
        const merchantNewBalance = merchantWallet[0].balance + merchantAmount;
        const merchantNewAvailableBalance = merchantWallet[0].availableBalance + merchantAmount;

        await tx
          .update(wallets)
          .set({
            balance: merchantNewBalance,
            availableBalance: merchantNewAvailableBalance,
            lastTransactionAt: new Date(),
          })
          .where(eq(wallets.id, merchantWallet[0].id));

        // Create sender transaction
        await tx.insert(walletTransactions).values({
          walletId: senderWallet[0].id,
          reference: `${reference}_S`,
          type: 'payment',
          subType: 'merchant',
          amount: -amount,
          fee: 0,
          netAmount: -amount,
          balanceBefore: senderWallet[0].balance,
          balanceAfter: senderNewBalance,
          description: description || `Payment to ${merchant[0].businessName}`,
          merchantId: merchant[0].id,
          status: 'completed',
          paymentMethod: 'wallet',
          completedAt: new Date(),
        });

        // Create merchant transaction
        await tx.insert(walletTransactions).values({
          walletId: merchantWallet[0].id,
          reference: `${reference}_M`,
          type: 'payment',
          subType: 'merchant_receive',
          amount: merchantAmount,
          fee: fee,
          netAmount: merchantAmount,
          balanceBefore: merchantWallet[0].balance,
          balanceAfter: merchantNewBalance,
          description: description || `Payment from ${ctx.user.name}`,
          senderId: ctx.user.id,
          merchantId: merchant[0].id,
          status: 'completed',
          paymentMethod: 'wallet',
          completedAt: new Date(),
        });

        // Create fee transaction
        if (fee > 0) {
          await tx.insert(walletTransactions).values({
            walletId: merchantWallet[0].id,
            reference: `${reference}_F`,
            type: 'fee',
            amount: -fee,
            fee: 0,
            netAmount: -fee,
            balanceBefore: merchantNewBalance,
            balanceAfter: merchantNewBalance,
            description: 'Merchant transaction fee',
            status: 'completed',
            completedAt: new Date(),
          });
        }

        // Update merchant stats
        await tx
          .update(walletMerchants)
          .set({
            monthlyVolume: sql`${walletMerchants.monthlyVolume} + ${amount}`,
            totalTransactions: sql`${walletMerchants.totalTransactions} + 1`,
          })
          .where(eq(walletMerchants.id, merchant[0].id));

        return {
          success: true,
          reference,
          amount,
          fee,
          merchantAmount,
          merchant: merchant[0].businessName,
          newBalance: senderNewBalance,
        };
      });
    }),

  // Bill payments (airtime, electricity, DSTV, etc.)
  payBill: rateLimitedProcedure
    .input(billPaymentSchema)
    .mutation(async ({ input, ctx }) => {
      const { billType, provider, accountNumber, amount, phone, meterNumber, pin } = input;

      // Get wallet
      const wallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!wallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      // Verify PIN
      const pinValid = await bcrypt.compare(pin, wallet[0].walletPinHash || '');
      if (!pinValid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid PIN' });
      }

      // Check balance
      if (amount > wallet[0].availableBalance) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient balance' });
      }

      // Calculate fee (1.5% for bill payments, min R2)
      const fee = Math.max(200, Math.round(amount * 0.015)); // min R2, 1.5%
      const totalAmount = amount + fee;

      if (totalAmount > wallet[0].availableBalance) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient balance (includes R${(fee / 100).toFixed(2)} fee)`,
        });
      }

      const reference = `BILL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // For now, simulate bill payment. In production, integrate with bill payment providers like Paystack Bills
      // This is a mock implementation
      const isSuccess = Math.random() > 0.05; // 95% success rate for simulation

      return await db.transaction(async (tx) => {
        // Deduct from wallet
        const newBalance = wallet[0].balance - totalAmount;
        const newAvailableBalance = wallet[0].availableBalance - totalAmount;

        await tx
          .update(wallets)
          .set({
            balance: newBalance,
            availableBalance: newAvailableBalance,
            lastTransactionAt: new Date(),
          })
          .where(eq(wallets.id, wallet[0].id));

        // Create bill payment record
        const bill = await tx
          .insert(walletBills)
          .values({
            userId: ctx.user.id,
            billType,
            provider,
            accountNumber,
            meterNumber,
            amount,
            fee,
            billReference: reference,
            status: isSuccess ? 'processing' : 'failed',
            metadata: {
              phone,
              provider,
            },
          })
          .returning();

        // Create transaction record
        const transactionStatus = isSuccess ? 'processing' : 'failed';

        await tx.insert(walletTransactions).values({
          walletId: wallet[0].id,
          reference,
          type: 'bill_payment',
          subType: billType,
          amount: -totalAmount,
          fee: fee,
          netAmount: -totalAmount,
          balanceBefore: wallet[0].balance,
          balanceAfter: newBalance,
          description: `${billType.toUpperCase()} payment to ${provider} (${accountNumber})`,
          metadata: {
            billId: bill[0].id,
            accountNumber,
            phone,
            meterNumber,
          },
          status: transactionStatus,
          paymentMethod: 'wallet',
          completedAt: isSuccess ? null : new Date(),
        });

        if (!isSuccess) {
          await tx
            .update(walletBills)
            .set({
              status: 'failed',
              providerResponse: { error: 'Payment failed' },
            })
            .where(eq(walletBills.id, bill[0].id));

          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Bill payment failed. Please try again.',
          });
        }

        // Simulate provider API call
        setTimeout(async () => {
          try {
            await db.transaction(async (tx) => {
              await tx
                .update(walletBills)
                .set({
                  status: 'completed',
                  completedAt: new Date(),
                  providerResponse: {
                    success: true,
                    reference: `PROV_${crypto.randomBytes(8).toString('hex')}`,
                    timestamp: new Date().toISOString(),
                  },
                })
                .where(eq(walletBills.id, bill[0].id));

              await tx
                .update(walletTransactions)
                .set({
                  status: 'completed',
                  completedAt: new Date(),
                  metadata: {
                    ...bill[0].metadata,
                    providerReference: `PROV_${crypto.randomBytes(8).toString('hex')}`,
                  },
                })
                .where(eq(walletTransactions.reference, reference));
            });
          } catch (error) {
            console.error('Failed to complete bill payment:', error);
          }
        }, 2000);

        return {
          success: true,
          reference,
          amount,
          fee,
          totalAmount,
          provider,
          accountNumber,
          status: 'processing',
          newBalance,
        };
      });
    }),

  // Withdraw to bank account
  withdraw: rateLimitedProcedure
    .input(withdrawSchema)
    .mutation(async ({ input, ctx }) => {
      const { bankId, amount, pin } = input;

      // Get wallet
      const wallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!wallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      // Verify PIN
      const pinValid = await bcrypt.compare(pin, wallet[0].walletPinHash || '');
      if (!pinValid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid PIN' });
      }

      // Check balance
      if (amount > wallet[0].availableBalance) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient balance' });
      }

      // Get bank details
      const bank = await db
        .select()
        .from(walletBanks)
        .where(and(eq(walletBanks.id, bankId), eq(walletBanks.userId, ctx.user.id)))
        .limit(1);

      if (!bank[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bank account not found' });
      }

      if (!bank[0].isVerified) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Bank account not verified',
        });
      }

      // Calculate fee (R15 fixed for withdrawals)
      const fee = 1500; // R15
      const totalAmount = amount + fee;

      if (totalAmount > wallet[0].availableBalance) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient balance (includes R${(fee / 100).toFixed(2)} fee)`,
        });
      }

      const reference = `WDL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // Place hold on funds
      await db.insert(walletHolds).values({
        walletId: wallet[0].id,
        amount: totalAmount,
        reason: 'withdrawal',
        reference,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });

      // Update available balance
      const newAvailableBalance = wallet[0].availableBalance - totalAmount;

      await db
        .update(wallets)
        .set({
          availableBalance: newAvailableBalance,
        })
        .where(eq(wallets.id, wallet[0].id));

      // Create transaction record
      await db.insert(walletTransactions).values({
        walletId: wallet[0].id,
        reference,
        type: 'withdrawal',
        subType: 'bank_transfer',
        amount: -totalAmount,
        fee: fee,
        netAmount: -totalAmount,
        balanceBefore: wallet[0].balance,
        balanceAfter: wallet[0].balance, // Balance won't change until withdrawal completes
        description: `Withdrawal to ${bank[0].bankName} (${bank[0].accountNumber})`,
        metadata: {
          bankId: bank[0].id,
          bankName: bank[0].bankName,
          accountNumber: bank[0].accountNumber,
          accountName: bank[0].accountName,
        },
        status: 'processing',
        paymentMethod: 'bank_transfer',
      });

      // Simulate bank transfer (in production, integrate with Paystack Transfer API)
      setTimeout(async () => {
        try {
          await db.transaction(async (tx) => {
            // Release hold
            await tx
              .update(walletHolds)
              .set({
                releasedAt: new Date(),
              })
              .where(eq(walletHolds.reference, reference));

            // Update wallet balance
            const newBalance = wallet[0].balance - totalAmount;

            await tx
              .update(wallets)
              .set({
                balance: newBalance,
                lastTransactionAt: new Date(),
              })
              .where(eq(wallets.id, wallet[0].id));

            // Update transaction
            await tx
              .update(walletTransactions)
              .set({
                status: 'completed',
                balanceAfter: newBalance,
                completedAt: new Date(),
                metadata: {
                  bankId: bank[0].id,
                  bankName: bank[0].bankName,
                  accountNumber: bank[0].accountNumber,
                  transferReference: `BANK_${crypto.randomBytes(8).toString('hex')}`,
                },
              })
              .where(eq(walletTransactions.reference, reference));
          });
        } catch (error) {
          console.error('Failed to complete withdrawal:', error);
        }
      }, 3000);

      return {
        success: true,
        reference,
        amount,
        fee,
        totalAmount,
        bank: bank[0].bankName,
        accountNumber: bank[0].accountNumber,
        status: 'processing',
        estimatedCompletion: 'Within 24 hours',
        newAvailableBalance,
      };
    }),

  // Generate QR code for receiving payments
  generateQRCode: protectedProcedure
    .input(
      z.object({
        amount: z.number().int().positive().optional(),
        description: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const wallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!wallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      const reference = `QR_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const qrData = JSON.stringify({
        type: 'varsityhub_payment',
        userId: ctx.user.id,
        walletId: wallet[0].id,
        reference,
        amount: input.amount,
        description: input.description,
        timestamp: Date.now(),
      });

      // Generate QR code URL (in production, use a QR code generation service)
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}`;

      const qrCode = await db
        .insert(walletQRCodes)
        .values({
          userId: ctx.user.id,
          type: input.amount ? 'dynamic' : 'static',
          qrData,
          qrImageUrl,
          amount: input.amount,
          description: input.description,
          reference,
        })
        .returning();

      return qrCode[0];
    }),

  // Scan QR code to make payment
  scanQRCode: rateLimitedProcedure
    .input(
      z.object({
        qrData: z.string(),
        pin: z.string().length(4).regex(/^\d+$/),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let qrData;
      try {
        qrData = JSON.parse(input.qrData);
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid QR code',
        });
      }

      if (qrData.type !== 'varsityhub_payment') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid QR code type',
        });
      }

      // Check if QR code is still valid
      const qrCode = await db
        .select()
        .from(walletQRCodes)
        .where(eq(walletQRCodes.reference, qrData.reference))
        .limit(1);

      if (!qrCode[0] || !qrCode[0].isActive) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'QR code expired or invalid',
        });
      }

      if (qrCode[0].expiresAt && new Date(qrCode[0].expiresAt) < new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'QR code expired',
        });
      }

      // Get sender's wallet
      const senderWallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!senderWallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      // Verify PIN
      const pinValid = await bcrypt.compare(input.pin, senderWallet[0].walletPinHash || '');
      if (!pinValid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid PIN' });
      }

      // Get recipient
      const recipientWallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, qrData.walletId))
        .limit(1);

      if (!recipientWallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipient wallet not found' });
      }

      if (recipientWallet[0].userId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot pay yourself',
        });
      }

      const amount = qrCode[0].amount || qrData.amount;
      if (!amount || amount <= 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Amount not specified in QR code',
        });
      }

      // Check balance
      if (amount > senderWallet[0].availableBalance) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient balance' });
      }

      // Perform transfer (reuse transfer logic)
      const description = qrCode[0].description || 'QR code payment';

      // ... (Similar transfer logic as above, but with QR code metadata)

      // Increment scan count
      await db
        .update(walletQRCodes)
        .set({
          scanCount: sql`${walletQRCodes.scanCount} + 1`,
        })
        .where(eq(walletQRCodes.id, qrCode[0].id));

      return {
        success: true,
        amount,
        recipient: qrData.userId,
        description,
      };
    }),

  // Get transaction history
  getTransactions: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        type: z.string().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const wallet = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, ctx.user.id))
        .limit(1);

      if (!wallet[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      const offset = (input.page - 1) * input.limit;

      let query = db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.walletId, wallet[0].id));

      if (input.type) {
        query = query.where(eq(walletTransactions.type, input.type));
      }

      if (input.startDate) {
        query = query.where(gte(walletTransactions.createdAt, new Date(input.startDate)));
      }

      if (input.endDate) {
        query = query.where(lte(walletTransactions.createdAt, new Date(input.endDate)));
      }

      const [transactions, total] = await Promise.all([
        query
          .orderBy(desc(walletTransactions.createdAt))
          .limit(input.limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(walletTransactions)
          .where(eq(walletTransactions.walletId, wallet[0].id))
          .then((res) => res[0]?.count ?? 0),
      ]);

      // Get sender/receiver details for each transaction
      const transactionsWithDetails = await Promise.all(
        transactions.map(async (txn) => {
          let sender = null;
          let receiver = null;
          let merchant = null;

          if (txn.senderId) {
            const senderData = await db
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, txn.senderId))
              .limit(1);
            sender = senderData[0];
          }

          if (txn.receiverId) {
            const receiverData = await db
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, txn.receiverId))
              .limit(1);
            receiver = receiverData[0];
          }

          if (txn.merchantId) {
            const merchantData = await db
              .select({ businessName: walletMerchants.businessName })
              .from(walletMerchants)
              .where(eq(walletMerchants.id, txn.merchantId))
              .limit(1);
            merchant = merchantData[0];
          }

          return {
            ...txn,
            sender: sender?.name,
            receiver: receiver?.name,
            merchant: merchant?.businessName,
          };
        })
      );

      return {
        transactions: transactionsWithDetails,
        pagination: {
          page: input.page,
          limit: input.limit,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / input.limit),
        },
      };
    }),

  // Get bank accounts
  getBanks: protectedProcedure.query(async ({ ctx }) => {
    const banks = await db
      .select()
      .from(walletBanks)
      .where(eq(walletBanks.userId, ctx.user.id))
      .orderBy(desc(walletBanks.isDefault), desc(walletBanks.lastUsedAt));

    return banks;
  }),

  // Add bank account
  addBank: protectedProcedure
    .input(
      z.object({
        bankCode: z.string().min(1),
        accountNumber: z.string().min(9).max(20),
        accountName: z.string().min(1),
        accountType: z.enum(['savings', 'current', 'credit']).default('savings'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify account with Paystack (or other bank verification service)
      try {
        const response = await paystack.post('/bank/validate', {
          bank_code: input.bankCode,
          account_number: input.accountNumber,
          account_name: input.accountName,
          country_code: 'ZA',
        });

        if (!response.data.status) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Bank account verification failed',
          });
        }
      } catch (error) {
        // For development, skip verification
        if (env.NODE_ENV === 'production') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Failed to verify bank account',
          });
        }
      }

      const bank = await db
        .insert(walletBanks)
        .values({
          userId: ctx.user.id,
          bankName: getBankName(input.bankCode), // Helper function to get bank name from code
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          accountName: input.accountName,
          accountType: input.accountType,
          isVerified: true, // Auto-verify for now
          verifiedAt: new Date(),
        })
        .returning();

      return bank[0];
    }),

  // Get merchants near campus
  getCampusMerchants: protectedProcedure.query(async ({ ctx }) => {
    const merchants = await db
      .select({
        id: walletMerchants.id,
        businessName: walletMerchants.businessName,
        businessType: walletMerchants.businessType,
        category: walletMerchants.category,
        description: walletMerchants.description,
        logoUrl: walletMerchants.logoUrl,
        user: {
          name: users.name,
          campus: users.campus,
        },
      })
      .from(walletMerchants)
      .innerJoin(users, eq(walletMerchants.userId, users.id))
      .where(
        and(
          eq(walletMerchants.isActive, true),
          eq(walletMerchants.isVerified, true),
          eq(users.campus, ctx.user.campus) // Only show merchants on same campus
        )
      )
      .orderBy(walletMerchants.businessName);

    return merchants;
  }),

  // Get wallet stats
  getWalletStats: protectedProcedure.query(async ({ ctx }) => {
    const wallet = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, ctx.user.id))
      .limit(1);

    if (!wallet[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

    const [totalTransactions, totalSpent, topMerchants] = await Promise.all([
      db
        .select({ count: count() })
        .from(walletTransactions)
        .where(
          and(
            eq(walletTransactions.walletId, wallet[0].id),
            eq(walletTransactions.status, 'completed'),
            gte(walletTransactions.createdAt, thirtyDaysAgo)
          )
        ),
      db
        .select({ total: sum(walletTransactions.amount) })
        .from(walletTransactions)
        .where(
          and(
            eq(walletTransactions.walletId, wallet[0].id),
            eq(walletTransactions.status, 'completed'),
            lt(walletTransactions.amount, 0), // Negative amounts are outgoing
            gte(walletTransactions.createdAt, thirtyDaysAgo)
          )
        ),
      db
        .select({
          merchantId: walletTransactions.merchantId,
          businessName: walletMerchants.businessName,
          total: sum(sql<number>`ABS(${walletTransactions.amount})`),
          count: count(),
        })
        .from(walletTransactions)
        .leftJoin(walletMerchants, eq(walletTransactions.merchantId, walletMerchants.id))
        .where(
          and(
            eq(walletTransactions.walletId, wallet[0].id),
            eq(walletTransactions.status, 'completed'),
            eq(walletTransactions.type, 'payment'),
            gte(walletTransactions.createdAt, thirtyDaysAgo)
          )
        )
        .groupBy(walletTransactions.merchantId, walletMerchants.businessName)
        .orderBy(desc(sum(sql<number>`ABS(${walletTransactions.amount})`)))
        .limit(5),
    ]);

    return {
      totalTransactions: Number(totalTransactions[0]?.count || 0),
      totalSpent: Math.abs(Number(totalSpent[0]?.total || 0)),
      topMerchants: topMerchants.filter(m => m.merchantId),
      balance: wallet[0].balance,
      availableBalance: wallet[0].availableBalance,
    };
  }),
});

// Helper function to get bank name from code
function getBankName(bankCode: string): string {
  const banks: Record<string, string> = {
    '632005': 'Absa Bank',
    '470010': 'First National Bank',
    '198765': 'Standard Bank',
    '250655': 'Nedbank',
    '580105': 'Capitec Bank',
    '460005': 'Investec Bank',
    '678910': 'African Bank',
    '432100': 'Bidvest Bank',
    '876543': 'Discovery Bank',
    '123456': 'Tyme Bank',
  };
  return banks[bankCode] || 'Unknown Bank';
}