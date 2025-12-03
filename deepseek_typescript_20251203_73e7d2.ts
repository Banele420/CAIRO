import { createTRPCRouter, adminProcedure } from '../_core/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, and, gte, lte, sql, count, sum } from 'drizzle-orm';
import { db } from '../db';
import {
  users,
  products,
  conversations,
  messages,
  events,
  forumPosts,
  jobListings,
  lostFoundPosts,
  paymentSubscriptions,
  paymentTransactions,
  reportedContent,
  analyticsEvents,
} from '../db/schema';

export const adminRouter = createTRPCRouter({
  // Dashboard stats
  getStats: adminProcedure
    .input(
      z.object({
        period: z.enum(['today', 'week', 'month', 'year']).default('month'),
      })
    )
    .query(async ({ input }) => {
      const now = new Date();
      let startDate = new Date();

      switch (input.period) {
        case 'today':
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
      }

      const [
        totalUsers,
        newUsers,
        totalProducts,
        activeProducts,
        totalEvents,
        totalTransactions,
        revenue,
        reportedCount,
      ] = await Promise.all([
        // Total users
        db.select({ count: count() }).from(users),
        // New users in period
        db
          .select({ count: count() })
          .from(users)
          .where(gte(users.createdAt, startDate)),
        // Total products
        db.select({ count: count() }).from(products),
        // Active products
        db
          .select({ count: count() })
          .from(products)
          .where(eq(products.isActive, true)),
        // Total events
        db.select({ count: count() }).from(events),
        // Total transactions
        db
          .select({ count: count() })
          .from(paymentTransactions)
          .where(gte(paymentTransactions.createdAt, startDate)),
        // Revenue in period
        db
          .select({ total: sum(paymentTransactions.amount) })
          .from(paymentTransactions)
          .where(
            and(
              gte(paymentTransactions.createdAt, startDate),
              eq(paymentTransactions.status, 'success')
            )
          ),
        // Reported content pending
        db
          .select({ count: count() })
          .from(reportedContent)
          .where(eq(reportedContent.status, 'pending')),
      ]);

      // User growth trend
      const userGrowth = await db.execute(sql`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM users
        WHERE created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);

      // Platform activity
      const activity = await db.execute(sql`
        SELECT 
          event_type,
          COUNT(*) as count
        FROM analytics_events
        WHERE created_at >= ${startDate}
        GROUP BY event_type
        ORDER BY count DESC
        LIMIT 10
      `);

      return {
        stats: {
          totalUsers: Number(totalUsers[0]?.count ?? 0),
          newUsers: Number(newUsers[0]?.count ?? 0),
          totalProducts: Number(totalProducts[0]?.count ?? 0),
          activeProducts: Number(activeProducts[0]?.count ?? 0),
          totalEvents: Number(totalEvents[0]?.count ?? 0),
          totalTransactions: Number(totalTransactions[0]?.count ?? 0),
          revenue: Number(revenue[0]?.total ?? 0) / 100, // Convert cents to Rands
          reportedCount: Number(reportedCount[0]?.count ?? 0),
        },
        userGrowth: userGrowth.rows,
        activity: activity.rows,
      };
    }),

  // User management
  getUsers: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().optional(),
        role: z.string().optional(),
        campus: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;

      let query = db.select().from(users);

      if (input.search) {
        query = query.where(
          or(
            like(users.name, `%${input.search}%`),
            like(users.email, `%${input.search}%`)
          )
        );
      }

      if (input.role) {
        query = query.where(eq(users.role, input.role));
      }

      if (input.campus) {
        query = query.where(eq(users.campus, input.campus));
      }

      const [usersList, total] = await Promise.all([
        query
          .orderBy(desc(users.createdAt))
          .limit(input.limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(users)
          .then((res) => res[0]?.count ?? 0),
      ]);

      return {
        users: usersList,
        pagination: {
          page: input.page,
          limit: input.limit,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / input.limit),
        },
      };
    }),

  // Update user
  updateUser: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        data: z.object({
          role: z.string().optional(),
          campus: z.string().optional(),
          isOnboarded: z.boolean().optional(),
          isSellerSubscribed: z.boolean().optional(),
          sellerSubscriptionExpiry: z.string().datetime().optional().nullable(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const { userId, data } = input;

      await db
        .update(users)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Content moderation
  getReportedContent: adminProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;

      let query = db
        .select({
          report: reportedContent,
          reporter: users,
        })
        .from(reportedContent)
        .innerJoin(users, eq(reportedContent.reporterId, users.id));

      if (input.status) {
        query = query.where(eq(reportedContent.status, input.status));
      }

      const [reports, total] = await Promise.all([
        query
          .orderBy(desc(reportedContent.createdAt))
          .limit(input.limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(reportedContent)
          .then((res) => res[0]?.count ?? 0),
      ]);

      // Get content details for each report
      const reportsWithContent = await Promise.all(
        reports.map(async (report) => {
          let content: any = null;
          
          switch (report.report.contentType) {
            case 'product':
              content = await db
                .select()
                .from(products)
                .where(eq(products.id, report.report.contentId))
                .limit(1);
              break;
            case 'forum_post':
              content = await db
                .select()
                .from(forumPosts)
                .where(eq(forumPosts.id, report.report.contentId))
                .limit(1);
              break;
            // Add other content types as needed
          }

          return {
            ...report,
            content: content[0] || null,
          };
        })
      );

      return {
        reports: reportsWithContent,
        pagination: {
          page: input.page,
          limit: input.limit,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / input.limit),
        },
      };
    }),

  // Update report status
  updateReport: adminProcedure
    .input(
      z.object({
        reportId: z.number().int().positive(),
        status: z.enum(['reviewed', 'resolved', 'dismissed']),
        resolutionNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db
        .update(reportedContent)
        .set({
          status: input.status,
          resolvedById: ctx.user.id,
          resolvedAt: new Date(),
          resolutionNotes: input.resolutionNotes,
          updatedAt: new Date(),
        })
        .where(eq(reportedContent.id, input.reportId));

      return { success: true };
    }),

  // Delete inappropriate content
  deleteContent: adminProcedure
    .input(
      z.object({
        contentType: z.enum(['product', 'forum_post', 'comment', 'event']),
        contentId: z.number().int().positive(),
        reason: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      switch (input.contentType) {
        case 'product':
          await db
            .update(products)
            .set({ isActive: false })
            .where(eq(products.id, input.contentId));
          break;
        case 'forum_post':
          await db
            .update(forumPosts)
            .set({ isLocked: true })
            .where(eq(forumPosts.id, input.contentId));
          break;
        case 'event':
          await db
            .update(events)
            .set({ isCancelled: true })
            .where(eq(events.id, input.contentId));
          break;
      }

      return { success: true };
    }),

  // Get system analytics
  getAnalytics: adminProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        groupBy: z.enum(['hour', 'day', 'week', 'month']).default('day'),
      })
    )
    .query(async ({ input }) => {
      const { startDate, endDate, groupBy } = input;

      // User signups
      const signups = await db.execute(sql`
        SELECT 
          DATE_TRUNC(${groupBy}, created_at) as period,
          COUNT(*) as count
        FROM users
        WHERE created_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
        GROUP BY period
        ORDER BY period ASC
      `);

      // Platform activity
      const activity = await db.execute(sql`
        SELECT 
          DATE_TRUNC(${groupBy}, created_at) as period,
          event_type,
          COUNT(*) as count
        FROM analytics_events
        WHERE created_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
        GROUP BY period, event_type
        ORDER BY period ASC
      `);

      // Revenue
      const revenue = await db.execute(sql`
        SELECT 
          DATE_TRUNC(${groupBy}, created_at) as period,
          SUM(amount) as total
        FROM payment_transactions
        WHERE 
          created_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
          AND status = 'success'
        GROUP BY period
        ORDER BY period ASC
      `);

      // Popular features
      const popularFeatures = await db.execute(sql`
        SELECT 
          page_path,
          COUNT(*) as views
        FROM analytics_events
        WHERE 
          created_at BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
          AND event_type = 'page_view'
        GROUP BY page_path
        ORDER BY views DESC
        LIMIT 10
      `);

      return {
        signups: signups.rows,
        activity: activity.rows,
        revenue: revenue.rows,
        popularFeatures: popularFeatures.rows,
      };
    }),
});