import { createTRPCRouter, protectedProcedure, sellerProcedure } from '../_core/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '../db';
import { paymentSubscriptions, paymentTransactions, users } from '../db/schema';
import axios from 'axios';
import { env } from '../_core/env';

const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

export const paymentsRouter = createTRPCRouter({
  // Initialize payment for subscription
  initializeSubscription: protectedProcedure
    .input(
      z.object({
        plan: z.enum(['premium', 'seller_pro']),
        interval: z.enum(['monthly', 'yearly']).default('monthly'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Check for existing active subscription
      const existing = await db
        .select()
        .from(paymentSubscriptions)
        .where(
          and(
            eq(paymentSubscriptions.userId, ctx.user.id),
            eq(paymentSubscriptions.plan, input.plan),
            eq(paymentSubscriptions.status, 'active')
          )
        )
        .limit(1);

      if (existing[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'You already have an active subscription for this plan',
        });
      }

      // Calculate amount based on plan and interval
      const amounts = {
        premium: { monthly: 5000, yearly: 50000 }, // R50/month, R500/year
        seller_pro: { monthly: 10000, yearly: 100000 }, // R100/month, R1000/year
      };

      const amount = amounts[input.plan][input.interval];

      // Initialize Paystack transaction
      const response = await paystack.post('/transaction/initialize', {
        email: user[0].email,
        amount: amount,
        currency: 'ZAR',
        reference: `VHSUB_${Date.now()}_${ctx.user.id}`,
        callback_url: `${process.env.FRONTEND_URL}/payment/callback`,
        metadata: {
          userId: ctx.user.id,
          plan: input.plan,
          interval: input.interval,
          type: 'subscription',
        },
      });

      if (!response.data.status) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to initialize payment',
        });
      }

      // Save transaction record
      await db.insert(paymentTransactions).values({
        userId: ctx.user.id,
        reference: response.data.data.reference,
        amount: amount,
        currency: 'ZAR',
        status: 'pending',
        description: `${input.plan} subscription (${input.interval})`,
        metadata: {
          plan: input.plan,
          interval: input.interval,
          authorization_url: response.data.data.authorization_url,
        },
      });

      return {
        authorizationUrl: response.data.data.authorization_url,
        reference: response.data.data.reference,
      };
    }),

  // Verify payment and activate subscription
  verifyPayment: protectedProcedure
    .input(z.object({ reference: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Verify with Paystack
      const response = await paystack.get(`/transaction/verify/${input.reference}`);

      if (!response.data.status || response.data.data.status !== 'success') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Payment verification failed',
        });
      }

      const transaction = response.data.data;
      const metadata = transaction.metadata;

      // Update transaction status
      await db
        .update(paymentTransactions)
        .set({
          status: 'success',
          paymentMethod: transaction.channel,
          metadata: transaction,
        })
        .where(eq(paymentTransactions.reference, input.reference));

      if (metadata.type === 'subscription') {
        // Calculate subscription dates
        const startDate = new Date();
        const nextBillingDate = new Date();
        
        if (metadata.interval === 'monthly') {
          nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
        } else {
          nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
        }

        // Create or update subscription
        await db.insert(paymentSubscriptions).values({
          userId: ctx.user.id,
          plan: metadata.plan,
          status: 'active',
          paystackSubscriptionCode: transaction.authorization?.subscription_code,
          paystackCustomerCode: transaction.customer?.customer_code,
          amount: transaction.amount,
          currency: transaction.currency,
          interval: metadata.interval,
          startDate: startDate,
          nextBillingDate: nextBillingDate,
        });

        // Update user based on plan
        const updates: any = {};
        if (metadata.plan === 'seller_pro') {
          updates.isSellerSubscribed = true;
          updates.sellerSubscriptionExpiry = nextBillingDate;
        }

        await db.update(users).set(updates).where(eq(users.id, ctx.user.id));
      }

      return { success: true, transaction: response.data.data };
    }),

  // Get user's subscriptions
  getMySubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const subscriptions = await db
      .select()
      .from(paymentSubscriptions)
      .where(eq(paymentSubscriptions.userId, ctx.user.id))
      .orderBy(paymentSubscriptions.createdAt);

    return subscriptions;
  }),

  // Cancel subscription
  cancelSubscription: protectedProcedure
    .input(z.object({ subscriptionId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const subscription = await db
        .select()
        .from(paymentSubscriptions)
        .where(
          and(
            eq(paymentSubscriptions.id, input.subscriptionId),
            eq(paymentSubscriptions.userId, ctx.user.id),
            eq(paymentSubscriptions.status, 'active')
          )
        )
        .limit(1);

      if (!subscription[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Active subscription not found' });
      }

      // If Paystack subscription exists, cancel it via API
      if (subscription[0].paystackSubscriptionCode) {
        try {
          await paystack.post(`/subscription/disable`, {
            code: subscription[0].paystackSubscriptionCode,
            token: subscription[0].paystackCustomerCode,
          });
        } catch (error) {
          console.error('Failed to cancel Paystack subscription:', error);
        }
      }

      // Update subscription status
      await db
        .update(paymentSubscriptions)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          endDate: new Date(),
        })
        .where(eq(paymentSubscriptions.id, input.subscriptionId));

      // Update user if seller subscription
      if (subscription[0].plan === 'seller_pro') {
        await db
          .update(users)
          .set({
            isSellerSubscribed: false,
            sellerSubscriptionExpiry: null,
          })
          .where(eq(users.id, ctx.user.id));
      }

      return { success: true };
    }),

  // Get transaction history
  getMyTransactions: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const offset = (input.page - 1) * input.limit;

      const [transactions, total] = await Promise.all([
        db
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.userId, ctx.user.id))
          .orderBy(paymentTransactions.createdAt)
          .limit(input.limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(paymentTransactions)
          .where(eq(paymentTransactions.userId, ctx.user.id))
          .then((res) => res[0]?.count ?? 0),
      ]);

      return {
        transactions,
        pagination: {
          page: input.page,
          limit: input.limit,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / input.limit),
        },
      };
    }),

  // Webhook handler for Paystack events
  handleWebhook: publicProcedure
    .input(z.object({ event: z.string(), data: z.any() }))
    .mutation(async ({ input }) => {
      const { event, data } = input;

      switch (event) {
        case 'charge.success':
          await handleSuccessfulCharge(data);
          break;

        case 'subscription.create':
          await handleSubscriptionCreate(data);
          break;

        case 'subscription.disable':
          await handleSubscriptionDisable(data);
          break;

        case 'invoice.create':
          await handleInvoiceCreate(data);
          break;

        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(data);
          break;
      }

      return { received: true };
    }),
});

async function handleSuccessfulCharge(data: any) {
  const { reference, metadata } = data;

  // Update transaction status
  await db
    .update(paymentTransactions)
    .set({ status: 'success' })
    .where(eq(paymentTransactions.reference, reference));

  if (metadata?.userId && metadata?.plan) {
    // Activate subscription
    const nextBillingDate = new Date();
    if (metadata.interval === 'monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    await db.insert(paymentSubscriptions).values({
      userId: metadata.userId,
      plan: metadata.plan,
      status: 'active',
      paystackSubscriptionCode: data.authorization?.subscription_code,
      paystackCustomerCode: data.customer?.customer_code,
      amount: data.amount,
      currency: data.currency,
      interval: metadata.interval || 'monthly',
      startDate: new Date(),
      nextBillingDate: nextBillingDate,
    });

    // Update user
    if (metadata.plan === 'seller_pro') {
      await db
        .update(users)
        .set({
          isSellerSubscribed: true,
          sellerSubscriptionExpiry: nextBillingDate,
        })
        .where(eq(users.id, metadata.userId));
    }
  }
}

async function handleSubscriptionDisable(data: any) {
  const { subscription_code } = data;

  await db
    .update(paymentSubscriptions)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      endDate: new Date(),
    })
    .where(eq(paymentSubscriptions.paystackSubscriptionCode, subscription_code));

  // Update user's seller status if applicable
  const subscription = await db
    .select()
    .from(paymentSubscriptions)
    .where(eq(paymentSubscriptions.paystackSubscriptionCode, subscription_code))
    .limit(1);

  if (subscription[0] && subscription[0].plan === 'seller_pro') {
    await db
      .update(users)
      .set({
        isSellerSubscribed: false,
        sellerSubscriptionExpiry: null,
      })
      .where(eq(users.id, subscription[0].userId));
  }
}