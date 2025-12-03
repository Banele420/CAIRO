import { createTRPCRouter, protectedProcedure, onboardedProcedure, rateLimitedProcedure } from '../_core/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, and, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { conversations, messages, users, products } from '../db/schema';

export const messagingRouter = createTRPCRouter({
  // Get conversations
  conversations: protectedProcedure.query(async ({ ctx }) => {
    const userConversations = await db
      .select({
        id: conversations.id,
        user1Id: conversations.user1Id,
        user2Id: conversations.user2Id,
        productId: conversations.productId,
        lastMessageAt: conversations.lastMessageAt,
        otherUser: sql<typeof users.$inferSelect>`
          CASE 
            WHEN ${conversations.user1Id} = ${ctx.user.id} THEN ${users}.*
            ELSE ${users}.*
          END
        `,
        product: products
          ? sql<typeof products.$inferSelect>`${products}.*`
          : null,
        lastMessage: sql<typeof messages.$inferSelect>`
          (SELECT ${messages}.* FROM ${messages} 
           WHERE ${messages.conversationId} = ${conversations.id}
           ORDER BY ${messages.createdAt} DESC LIMIT 1)
        `,
        unreadCount: sql<number>`
          (SELECT COUNT(*) FROM ${messages} 
           WHERE ${messages.conversationId} = ${conversations.id}
           AND ${messages.senderId} != ${ctx.user.id}
           AND ${messages.isRead} = false)
        `,
      })
      .from(conversations)
      .leftJoin(users, 
        or(
          and(
            eq(conversations.user1Id, ctx.user.id),
            eq(conversations.user2Id, users.id)
          ),
          and(
            eq(conversations.user2Id, ctx.user.id),
            eq(conversations.user1Id, users.id)
          )
        )
      )
      .leftJoin(products, eq(conversations.productId, products.id))
      .where(
        and(
          or(
            eq(conversations.user1Id, ctx.user.id),
            eq(conversations.user2Id, ctx.user.id)
          ),
          ctx.user.id === conversations.user1Id 
            ? eq(conversations.user1Deleted, false)
            : eq(conversations.user2Deleted, false)
        )
      )
      .orderBy(desc(conversations.lastMessageAt));

    return userConversations;
  }),

  // Get or create conversation
  getOrCreate: onboardedProcedure
    .input(
      z.object({
        otherUserId: z.number().int().positive().optional(),
        productId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!input.otherUserId && !input.productId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Either otherUserId or productId is required',
        });
      }

      let otherUserId = input.otherUserId;

      // If productId provided, get the seller
      if (input.productId && !otherUserId) {
        const product = await db
          .select({ sellerId: products.sellerId })
          .from(products)
          .where(eq(products.id, input.productId))
          .limit(1);

        if (!product[0]) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Product not found',
          });
        }

        otherUserId = product[0].sellerId;
      }

      if (!otherUserId || otherUserId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid conversation partner',
        });
      }

      // Check if conversation exists
      const existing = await db
        .select()
        .from(conversations)
        .where(
          or(
            and(
              eq(conversations.user1Id, ctx.user.id),
              eq(conversations.user2Id, otherUserId)
            ),
            and(
              eq(conversations.user1Id, otherUserId),
              eq(conversations.user2Id, ctx.user.id)
            )
          )
        )
        .limit(1);

      if (existing[0]) {
        // Restore if deleted
        if (
          (existing[0].user1Id === ctx.user.id && existing[0].user1Deleted) ||
          (existing[0].user2Id === ctx.user.id && existing[0].user2Deleted)
        ) {
          await db
            .update(conversations)
            .set(
              ctx.user.id === existing[0].user1Id
                ? { user1Deleted: false }
                : { user2Deleted: false }
            )
            .where(eq(conversations.id, existing[0].id));
        }

        return existing[0];
      }

      // Create new conversation
      const [smallerId, largerId] =
        ctx.user.id < otherUserId
          ? [ctx.user.id, otherUserId]
          : [otherUserId, ctx.user.id];

      const conversation = await db
        .insert(conversations)
        .values({
          user1Id: smallerId,
          user2Id: largerId,
          productId: input.productId,
        })
        .returning();

      return conversation[0];
    }),

  // Get messages
  messages: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        before: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify conversation access
      const conversation = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1);

      if (!conversation[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Conversation not found',
        });
      }

      if (
        conversation[0].user1Id !== ctx.user.id &&
        conversation[0].user2Id !== ctx.user.id
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      let query = db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId));

      if (input.before) {
        query = query.where(sql`${messages.createdAt} < ${new Date(input.before)}`);
      }

      const messagesList = await query
        .orderBy(desc(messages.createdAt))
        .limit(input.limit);

      // Mark messages as read (only other user's messages)
      await db
        .update(messages)
        .set({ isRead: true, readAt: new Date() })
        .where(
          and(
            eq(messages.conversationId, input.conversationId),
            eq(messages.isRead, false),
            eq(messages.senderId, ctx.user.id)
          )
        );

      return messagesList.reverse(); // Return chronological
    }),

  // Send message
  send: rateLimitedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        content: z.string().min(1).max(2000),
        attachments: z.array(z.string().url()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify conversation access
      const conversation = await db
        .select({
          id: conversations.id,
          user1Id: conversations.user1Id,
          user2Id: conversations.user2Id,
          user1Deleted: conversations.user1Deleted,
          user2Deleted: conversations.user2Deleted,
        })
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1);

      if (!conversation[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Conversation not found',
        });
      }

      if (
        conversation[0].user1Id !== ctx.user.id &&
        conversation[0].user2Id !== ctx.user.id
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Check if user deleted conversation
      if (
        (conversation[0].user1Id === ctx.user.id && conversation[0].user1Deleted) ||
        (conversation[0].user2Id === ctx.user.id && conversation[0].user2Deleted)
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You have left this conversation',
        });
      }

      const receiverId =
        conversation[0].user1Id === ctx.user.id
          ? conversation[0].user2Id
          : conversation[0].user1Id;

      // Create message
      const message = await db
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          senderId: ctx.user.id,
          content: input.content,
          attachments: input.attachments,
        })
        .returning();

      // Update conversation last message time
      await db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, input.conversationId));

      // Create notification for receiver
      await db.insert(notifications).values({
        userId: receiverId,
        type: 'message',
        title: 'New Message',
        message: `${ctx.user.name}: ${input.content.substring(0, 50)}...`,
        relatedId: input.conversationId,
      });

      return message[0];
    }),

  // Delete conversation (soft delete)
  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const conversation = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1);

      if (!conversation[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
        });
      }

      // Determine which user field to update
      const isUser1 = conversation[0].user1Id === ctx.user.id;
      const updateField = isUser1 ? 'user1Deleted' : 'user2Deleted';

      await db
        .update(conversations)
        .set({ [updateField]: true })
        .where(eq(conversations.id, input.conversationId));

      return { success: true };
    }),

  // Mark all messages as read
  markAllAsRead: protectedProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .update(messages)
        .set({ isRead: true, readAt: new Date() })
        .where(
          and(
            eq(messages.conversationId, input.conversationId),
            eq(messages.senderId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  // Search users to message
  searchUsers: onboardedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(100),
        excludeConversations: z.boolean().default(false),
      })
    )
    .query(async ({ input, ctx }) => {
      let usersQuery = db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          campus: users.campus,
        })
        .from(users)
        .where(
          and(
            eq(users.isOnboarded, true),
            or(
              like(users.name, `%${input.query}%`),
              like(users.email, `%${input.query}%`)
            ),
            eq(users.id, ctx.user.id)
          )
        )
        .limit(20);

      if (input.excludeConversations) {
        // Get users you already have conversations with
        const existingConversations = await db
          .select({
            otherUserId: sql<number>`
              CASE 
                WHEN ${conversations.user1Id} = ${ctx.user.id} THEN ${conversations.user2Id}
                ELSE ${conversations.user1Id}
              END
            `,
          })
          .from(conversations)
          .where(
            or(
              eq(conversations.user1Id, ctx.user.id),
              eq(conversations.user2Id, ctx.user.id)
            )
          );

        const excludedIds = existingConversations.map((c) => c.otherUserId);
        if (excludedIds.length > 0) {
          usersQuery = usersQuery.where(
            and(
              eq(users.id, ctx.user.id),
              eq(users.id, excludedIds)
            )
          );
        }
      }

      return usersQuery;
    }),
});