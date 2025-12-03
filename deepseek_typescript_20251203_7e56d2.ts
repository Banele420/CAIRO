import { pgTable, serial, integer, decimal, varchar, text, timestamp, jsonb, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './schema';
import { z } from 'zod';

// Wallet system tables
export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  balance: integer('balance').notNull().default(0), // in cents (ZAR)
  availableBalance: integer('available_balance').notNull().default(0), // available after holds
  currency: varchar('currency', { length: 3 }).default('ZAR'),
  walletPinHash: varchar('wallet_pin_hash', { length: 255 }),
  walletPinSalt: varchar('wallet_pin_salt', { length: 255 }),
  dailyLimit: integer('daily_limit').default(500000), // R5000 default
  monthlyLimit: integer('monthly_limit').default(2000000), // R20000 default
  isActive: boolean('is_active').default(true),
  isVerified: boolean('is_verified').default(false),
  verificationLevel: varchar('verification_level', { length: 20 }).default('basic'), // basic, intermediate, full
  lastTransactionAt: timestamp('last_transaction_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: serial('id').primaryKey(),
  walletId: integer('wallet_id').notNull().references(() => wallets.id),
  reference: varchar('reference', { length: 100 }).unique().notNull(),
  type: varchar('type', { length: 50 }).notNull(), // deposit, withdrawal, transfer, payment, refund, airtime, electricity, bill_payment
  subType: varchar('sub_type', { length: 50 }), // p2p, merchant, bank_transfer, card_deposit
  amount: integer('amount').notNull(), // in cents
  fee: integer('fee').default(0), // in cents
  netAmount: integer('net_amount').notNull(), // amount - fee
  currency: varchar('currency', { length: 3 }).default('ZAR'),
  balanceBefore: integer('balance_before').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  description: text('description'),
  metadata: jsonb('metadata').default({}),
  senderId: integer('sender_id').references(() => users.id),
  receiverId: integer('receiver_id').references(() => users.id),
  merchantId: integer('merchant_id').references(() => users.id),
  status: varchar('status', { length: 20 }).default('pending'), // pending, processing, completed, failed, cancelled
  paymentMethod: varchar('payment_method', { length: 50 }), // wallet, card, bank, ussd
  paymentReference: varchar('payment_reference', { length: 100 }),
  completedAt: timestamp('completed_at'),
  failureReason: text('failure_reason'),
  ipAddress: varchar('ip_address', { length: 45 }),
  deviceInfo: jsonb('device_info').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const walletHolds = pgTable('wallet_holds', {
  id: serial('id').primaryKey(),
  walletId: integer('wallet_id').notNull().references(() => wallets.id),
  transactionId: integer('transaction_id').references(() => walletTransactions.id),
  amount: integer('amount').notNull(),
  reason: varchar('reason', { length: 100 }).notNull(), // pending_payment, dispute, fraud_check
  reference: varchar('reference', { length: 100 }).unique().notNull(),
  expiresAt: timestamp('expires_at'),
  releasedAt: timestamp('released_at'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const walletBanks = pgTable('wallet_banks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  bankName: varchar('bank_name', { length: 100 }).notNull(),
  bankCode: varchar('bank_code', { length: 20 }).notNull(),
  accountNumber: varchar('account_number', { length: 50 }).notNull(),
  accountName: varchar('account_name', { length: 255 }).notNull(),
  accountType: varchar('account_type', { length: 20 }).default('savings'), // savings, current, credit
  isVerified: boolean('is_verified').default(false),
  isDefault: boolean('is_default').default(false),
  verifiedAt: timestamp('verified_at'),
  lastUsedAt: timestamp('last_used_at'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const walletCards = pgTable('wallet_cards', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  cardType: varchar('card_type', { length: 20 }).notNull(), // visa, mastercard, verve
  lastFour: varchar('last_four', { length: 4 }).notNull(),
  expiryMonth: integer('expiry_month').notNull(),
  expiryYear: integer('expiry_year').notNull(),
  issuer: varchar('issuer', { length: 100 }),
  authorizationCode: varchar('authorization_code', { length: 100 }),
  paystackToken: varchar('paystack_token', { length: 100 }),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const walletMerchants = pgTable('wallet_merchants', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  businessName: varchar('business_name', { length: 255 }).notNull(),
  businessType: varchar('business_type', { length: 100 }).notNull(),
  category: varchar('category', { length: 100 }),
  address: text('address'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  website: varchar('website', { length: 255 }),
  logoUrl: text('logo_url'),
  description: text('description'),
  transactionFeePercentage: decimal('transaction_fee_percentage', { precision: 5, scale: 2 }).default('0.00'),
  settlementBankId: integer('settlement_bank_id').references(() => walletBanks.id),
  isVerified: boolean('is_verified').default(false),
  isActive: boolean('is_active').default(true),
  verificationStatus: varchar('verification_status', { length: 20 }).default('pending'),
  monthlyVolume: integer('monthly_volume').default(0), // in cents
  totalTransactions: integer('total_transactions').default(0),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const walletQRCodes = pgTable('wallet_qr_codes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  type: varchar('type', { length: 20 }).notNull(), // static, dynamic
  qrData: text('qr_data').notNull(),
  qrImageUrl: text('qr_image_url'),
  amount: integer('amount'),
  description: varchar('description', { length: 255 }),
  reference: varchar('reference', { length: 100 }).unique().notNull(),
  isActive: boolean('is_active').default(true),
  expiresAt: timestamp('expires_at'),
  scanCount: integer('scan_count').default(0),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const walletBills = pgTable('wallet_bills', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  billType: varchar('bill_type', { length: 50 }).notNull(), // electricity, water, dstv, gotv, startimes, airtime, data
  provider: varchar('provider', { length: 100 }).notNull(), // eskom, city_power, dstv, mtn, vodacom, etc.
  accountNumber: varchar('account_number', { length: 100 }),
  meterNumber: varchar('meter_number', { length: 100 }),
  customerName: varchar('customer_name', { length: 255 }),
  amount: integer('amount').notNull(),
  fee: integer('fee').default(0),
  billReference: varchar('bill_reference', { length: 100 }),
  transactionId: integer('transaction_id').references(() => walletTransactions.id),
  status: varchar('status', { length: 20 }).default('pending'), // pending, processing, completed, failed
  providerResponse: jsonb('provider_response').default({}),
  completedAt: timestamp('completed_at'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const walletRecipients = pgTable('wallet_recipients', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  recipientType: varchar('recipient_type', { length: 20 }).notNull(), // user, bank, merchant, biller
  recipientId: integer('recipient_id'), // user_id or merchant_id
  bankId: integer('bank_id').references(() => walletBanks.id),
  recipientName: varchar('recipient_name', { length: 255 }).notNull(),
  recipientIdentifier: varchar('recipient_identifier', { length: 255 }), // phone, email, account number
  isFavorite: boolean('is_favorite').default(false),
  lastTransactionAt: timestamp('last_transaction_at'),
  totalTransactions: integer('total_transactions').default(0),
  totalAmount: integer('total_amount').default(0),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
  transactions: many(walletTransactions),
  holds: many(walletHolds),
  banks: many(walletBanks),
  cards: many(walletCards),
}));

// Zod schemas
export const createWalletSchema = z.object({
  pin: z.string().length(4).regex(/^\d+$/, 'PIN must be 4 digits'),
});

export const fundWalletSchema = z.object({
  amount: z.number().int().min(100).max(10000000), // R1 to R100,000
  paymentMethod: z.enum(['card', 'bank_transfer', 'ussd']),
  cardId: z.number().int().positive().optional(),
  bankId: z.number().int().positive().optional(),
});

export const transferSchema = z.object({
  recipientIdentifier: z.string().min(1), // phone, email, or VarsityHub ID
  amount: z.number().int().min(10).max(500000), // R0.10 to R5000
  pin: z.string().length(4).regex(/^\d+$/),
  description: z.string().max(100).optional(),
});

export const billPaymentSchema = z.object({
  billType: z.enum(['electricity', 'water', 'dstv', 'gotv', 'startimes', 'airtime', 'data']),
  provider: z.string().min(1),
  accountNumber: z.string().min(1),
  amount: z.number().int().min(50), // minimum R0.50
  phone: z.string().optional(), // for airtime/data
  meterNumber: z.string().optional(), // for electricity
  pin: z.string().length(4).regex(/^\d+$/),
});

export const withdrawSchema = z.object({
  bankId: z.number().int().positive(),
  amount: z.number().int().min(100).max(500000), // R1 to R5000
  pin: z.string().length(4).regex(/^\d+$/),
});

export type InsertWallet = typeof wallets.$inferInsert;
export type SelectWallet = typeof wallets.$inferSelect;
export type InsertWalletTransaction = typeof walletTransactions.$inferInsert;
export type SelectWalletTransaction = typeof walletTransactions.$inferSelect;