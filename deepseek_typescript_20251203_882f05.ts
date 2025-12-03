import { TRPCError } from '@trpc/server';
import { Request, Response, NextFunction } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { walletTransactions, wallets } from '../db/schema-wallet';

export class WalletSecurity {
  // Rate limiting per user
  private static userLimits = new Map<number, { count: number; resetTime: number }>();

  // Check for suspicious activity
  static async checkSuspiciousActivity(
    userId: number,
    amount: number,
    transactionType: string
  ): Promise<{ isSuspicious: boolean; reason?: string }> {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Check transaction frequency
    const recentTransactions = await db
      .select({ count: count() })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .where(
        and(
          eq(wallets.userId, userId),
          gte(walletTransactions.createdAt, oneHourAgo),
          eq(walletTransactions.status, 'completed')
        )
      );

    if (recentTransactions[0]?.count >= 10) {
      return {
        isSuspicious: true,
        reason: 'Too many transactions in the last hour',
      };
    }

    // Check amount limits
    const wallet = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);

    if (wallet[0]) {
      if (amount > wallet[0].dailyLimit) {
        return {
          isSuspicious: true,
          reason: 'Amount exceeds daily limit',
        };
      }

      // Check 24-hour volume
      const dailyVolume = await db
        .select({ total: sum(walletTransactions.amount) })
        .from(walletTransactions)
        .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
        .where(
          and(
            eq(wallets.userId, userId),
            gte(walletTransactions.createdAt, twentyFourHoursAgo),
            eq(walletTransactions.status, 'completed')
          )
        );

      const totalDaily = Math.abs(Number(dailyVolume[0]?.total || 0));
      if (totalDaily + amount > wallet[0].monthlyLimit) {
        return {
          isSuspicious: true,
          reason: 'Would exceed monthly limit',
        };
      }
    }

    // Check for unusual patterns (simplified)
    if (
      transactionType === 'transfer' &&
      amount > 100000 && // R1000
      recentTransactions[0]?.count === 0
    ) {
      return {
        isSuspicious: true,
        reason: 'Large first transfer',
      };
    }

    return { isSuspicious: false };
  }

  // Validate PIN strength
  static validatePIN(pin: string): { valid: boolean; message?: string } {
    if (pin.length !== 4) {
      return { valid: false, message: 'PIN must be 4 digits' };
    }

    if (!/^\d+$/.test(pin)) {
      return { valid: false, message: 'PIN must contain only numbers' };
    }

    // Check for simple patterns
    if (/(\d)\1{3}/.test(pin)) {
      return { valid: false, message: 'PIN cannot be all the same digit' };
    }

    if (['1234', '4321', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999'].includes(pin)) {
      return { valid: false, message: 'PIN is too common' };
    }

    return { valid: true };
  }

  // Device fingerprinting
  static generateDeviceFingerprint(req: Request): string {
    const components = [
      req.headers['user-agent'],
      req.headers['accept-language'],
      req.headers['accept-encoding'],
      req.ip,
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256').update(components).digest('hex');
  }

  // Check for duplicate transactions
  static async checkDuplicateTransaction(
    walletId: number,
    amount: number,
    recipientId?: number,
    withinMinutes: number = 5
  ): Promise<boolean> {
    const timeWindow = new Date(Date.now() - withinMinutes * 60 * 1000);

    const duplicate = await db
      .select()
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, walletId),
          eq(walletTransactions.amount, amount),
          eq(walletTransactions.status, 'completed'),
          gte(walletTransactions.createdAt, timeWindow),
          recipientId ? eq(walletTransactions.receiverId, recipientId) : undefined
        )
      )
      .limit(1);

    return duplicate.length > 0;
  }

  // IP-based restrictions
  static async checkIPRestrictions(
    ipAddress: string,
    userId: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check if IP has been blocked
    const blockedIPs = ['']; // Load from database in production
    if (blockedIPs.includes(ipAddress)) {
      return { allowed: false, reason: 'IP address blocked' };
    }

    // Check for multiple accounts from same IP (simplified)
    const accountsFromIP = await db
      .select({ count: count() })
      .from(walletTransactions)
      .where(eq(walletTransactions.ipAddress, ipAddress));

    if (accountsFromIP[0]?.count > 5) {
      return {
        allowed: false,
        reason: 'Too many accounts from this IP address',
      };
    }

    return { allowed: true };
  }
}

// Express middleware for wallet security
export const walletSecurityMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).user?.id;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!userId) {
      return next();
    }

    // Check IP restrictions
    const ipCheck = await WalletSecurity.checkIPRestrictions(
      ipAddress as string,
      userId
    );

    if (!ipCheck.allowed) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: ipCheck.reason,
      });
    }

    // Add device fingerprint to request
    (req as any).deviceFingerprint = WalletSecurity.generateDeviceFingerprint(req);

    next();
  } catch (error) {
    next(error);
  }
};