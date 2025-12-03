// Wallet system
export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  balance: integer('balance').notNull().default(0), // in cents (or smallest currency unit)
  currency: varchar('currency', { length: 3 }).default('ZAR'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: serial('id').primaryKey(),
  walletId: integer('wallet_id').notNull().references(() => wallets.id),
  amount: integer('amount').notNull(), // positive for credit, negative for debit
  balanceBefore: integer('balance_before').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  type: varchar('type', { length: 50 }).notNull(), // 'deposit', 'transfer', 'payment', 'withdrawal', 'refund'
  description: text('description'),
  reference: varchar('reference', { length: 100 }).unique(),
  metadata: jsonb('metadata').default({}),
  status: varchar('status', { length: 20 }).default('pending'), // pending, completed, failed, cancelled
  createdAt: timestamp('created_at').defaultNow(),
});