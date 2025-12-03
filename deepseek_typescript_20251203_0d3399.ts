import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { AuthContext } from './auth';
import { isAuthenticated, isAdmin, isSeller, isOnboarded } from './auth';

export const t = initTRPC.context<AuthContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

// Base router and procedure helpers
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  const user = isAuthenticated(ctx);
  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});
export const onboardedProcedure = t.procedure.use(({ ctx, next }) => {
  const user = isOnboarded(ctx);
  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});
export const sellerProcedure = t.procedure.use(({ ctx, next }) => {
  const user = isSeller(ctx);
  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  const user = isAdmin(ctx);
  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});

// Rate limiting middleware
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 s'),
});

export const rateLimitedProcedure = t.procedure.use(
  async ({ ctx, next }) => {
    const identifier = ctx.user?.id.toString() ?? ctx.req?.ip ?? 'anonymous';
    const { success } = await ratelimit.limit(identifier);
    
    if (!success) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. Please try again later.',
      });
    }
    
    return next();
  }
);