import jwt from 'jsonwebtoken';
import { TRPCError } from '@trpc/server';
import { type CreateNextContextOptions } from '@trpc/server/adapters/next';
import { type NodeHTTPCreateContextFnOptions } from '@trpc/server/adapters/node-http';
import { getCookie, setCookie } from 'cookies-next';
import { cookies, headers } from 'next/headers';
import { env } from './env';

export interface UserSession {
  id: number;
  openId: string;
  email: string;
  name?: string;
  role: string;
  campus?: string;
  isOnboarded: boolean;
  isSellerSubscribed: boolean;
}

export interface AuthContext {
  user: UserSession | null;
  req: any;
  res: any;
}

// JWT token management
export const createToken = (user: UserSession): string => {
  return jwt.sign(
    {
      id: user.id,
      openId: user.openId,
      email: user.email,
      role: user.role,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
};

export const verifyToken = (token: string): UserSession => {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as UserSession;
    return decoded;
  } catch (error) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
    });
  }
};

// Manus OAuth simulation (in production, would integrate with real Manus API)
export const simulateManusOAuth = async (studentNumber: string): Promise<{
  openId: string;
  email: string;
  name: string;
  studentNumber: string;
}> => {
  // Validate student number format
  if (!/^\d+$/.test(studentNumber)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid student number format',
    });
  }

  // In production, this would call Manus API
  // For simulation, generate deterministic data
  return {
    openId: `manus_${studentNumber}`,
    email: `${studentNumber}@ufs4life.ac.za`,
    name: `Student ${studentNumber}`,
    studentNumber,
  };
};

// OTP system for email verification
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const verifyOTP = (storedOTP: string, providedOTP: string): boolean => {
  return storedOTP === providedOTP;
};

// Authentication middleware for tRPC
export const createContext = async (
  opts: CreateNextContextOptions | NodeHTTPCreateContextFnOptions<any, any>
): Promise<AuthContext> => {
  let token: string | undefined;
  
  if ('req' in opts && 'res' in opts) {
    // HTTP context
    token = getCookie('varsityhub_token', { req: opts.req, res: opts.res }) as string;
    if (!token) {
      const authHeader = opts.req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
  } else {
    // Next.js server components context
    const cookieStore = await cookies();
    token = cookieStore.get('varsityhub_token')?.value;
  }

  let user: UserSession | null = null;

  if (token) {
    try {
      user = verifyToken(token);
    } catch (error) {
      // Token invalid, clear cookie
      if ('req' in opts && 'res' in opts) {
        setCookie('varsityhub_token', '', {
          req: opts.req,
          res: opts.res,
          maxAge: -1,
        });
      }
    }
  }

  return {
    user,
    req: 'req' in opts ? opts.req : null,
    res: 'res' in opts ? opts.res : null,
  };
};

// Protected procedure middleware
export const isAuthenticated = (ctx: AuthContext): UserSession => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to access this resource',
    });
  }
  return ctx.user;
};

export const isAdmin = (ctx: AuthContext): UserSession => {
  const user = isAuthenticated(ctx);
  if (user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }
  return user;
};

export const isSeller = (ctx: AuthContext): UserSession => {
  const user = isAuthenticated(ctx);
  if (!user.isSellerSubscribed && user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Seller subscription required',
    });
  }
  return user;
};

export const isOnboarded = (ctx: AuthContext): UserSession => {
  const user = isAuthenticated(ctx);
  if (!user.isOnboarded) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Complete onboarding first',
    });
  }
  return user;
};