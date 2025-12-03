import { createTRPCRouter, protectedProcedure, onboardedProcedure, sellerProcedure, rateLimitedProcedure } from '../_core/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, and, or, like, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import { products, users, conversations, productReviews, insertProductSchema } from '../db/schema';

export const marketplaceRouter = createTRPCRouter({
  // List products with filters
  list: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        campus: z.string().optional(),
        minPrice: z.number().int().min(0).optional(),
        maxPrice: z.number().int().min(0).optional(),
        condition: z.enum(['new', 'like_new', 'good', 'fair']).optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        sortBy: z.enum(['newest', 'price_low', 'price_high', 'popular']).default('newest'),
      })
    )
    .query(async ({ input, ctx }) => {
      const { category, campus, minPrice, maxPrice, condition, search, page, limit, sortBy } = input;
      const offset = (page - 1) * limit;

      let query = db
        .select({
          id: products.id,
          title: products.title,
          description: products.description,
          category: products.category,
          price: products.price,
          condition: products.condition,
          images: products.images,
          location: products.location,
          deliveryOption: products.deliveryOption,
          isNegotiable: products.isNegotiable,
          rating: products.rating,
          reviewCount: products.reviewCount,
          viewCount: products.viewCount,
          createdAt: products.createdAt,
          seller: {
            id: users.id,
            name: users.name,
            campus: users.campus,
            isSellerSubscribed: users.isSellerSubscribed,
          },
        })
        .from(products)
        .innerJoin(users, eq(products.sellerId, users.id))
        .where(
          and(
            eq(products.isActive, true),
            category ? eq(products.category, category) : undefined,
            campus ? eq(users.campus, campus) : undefined,
            minPrice ? sql`${products.price} >= ${minPrice}` : undefined,
            maxPrice ? sql`${products.price} <= ${maxPrice}` : undefined,
            condition ? eq(products.condition, condition) : undefined,
            search
              ? or(
                  like(products.title, `%${search}%`),
                  like(products.description, `%${search}%`),
                  sql`${products.tags}::text LIKE ${`%${search}%`}`
                )
              : undefined
          )
        );

      // Apply sorting
      switch (sortBy) {
        case 'newest':
          query = query.orderBy(desc(products.createdAt));
          break;
        case 'price_low':
          query = query.orderBy(products.price);
          break;
        case 'price_high':
          query = query.orderBy(desc(products.price));
          break;
        case 'popular':
          query = query.orderBy(desc(products.viewCount));
          break;
      }

      const [items, totalResult] = await Promise.all([
        query.limit(limit).offset(offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(products)
          .innerJoin(users, eq(products.sellerId, users.id))
          .where(
            and(
              eq(products.isActive, true),
              category ? eq(products.category, category) : undefined,
              campus ? eq(users.campus, campus) : undefined,
              minPrice ? sql`${products.price} >= ${minPrice}` : undefined,
              maxPrice ? sql`${products.price} <= ${maxPrice}` : undefined,
              condition ? eq(products.condition, condition) : undefined,
              search
                ? or(
                    like(products.title, `%${search}%`),
                    like(products.description, `%${search}%`)
                  )
                : undefined
            )
          )
          .then((res) => res[0]?.count ?? 0),
      ]);

      // Increment view counts (in background)
      items.forEach((item) => {
        db.update(products)
          .set({ viewCount: sql`${products.viewCount} + 1` })
          .where(eq(products.id, item.id))
          .execute()
          .catch(console.error);
      });

      return {
        items,
        pagination: {
          page,
          limit,
          total: Number(totalResult),
          totalPages: Math.ceil(Number(totalResult) / limit),
        },
      };
    }),

  // Get single product
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const product = await db
        .select({
          id: products.id,
          title: products.title,
          description: products.description,
          category: products.category,
          price: products.price,
          condition: products.condition,
          images: products.images,
          location: products.location,
          deliveryOption: products.deliveryOption,
          isNegotiable: products.isNegotiable,
          rating: products.rating,
          reviewCount: products.reviewCount,
          viewCount: products.viewCount,
          tags: products.tags,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
          seller: {
            id: users.id,
            name: users.name,
            email: users.email,
            campus: users.campus,
            residence: users.residence,
            isSellerSubscribed: users.isSellerSubscribed,
            createdAt: users.createdAt,
          },
        })
        .from(products)
        .innerJoin(users, eq(products.sellerId, users.id))
        .where(and(eq(products.id, input.id), eq(products.isActive, true)))
        .limit(1);

      if (!product[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Product not found',
        });
      }

      // Increment view count
      await db
        .update(products)
        .set({ viewCount: sql`${products.viewCount} + 1` })
        .where(eq(products.id, input.id));

      return product[0];
    }),

  // Create product listing
  create: sellerProcedure
    .input(insertProductSchema)
    .mutation(async ({ input, ctx }) => {
      const product = await db
        .insert(products)
        .values({
          sellerId: ctx.user.id,
          ...input,
          price: input.price * 100, // Convert to cents
        })
        .returning();

      // Create notification for seller
      await db.insert(notifications).values({
        userId: ctx.user.id,
        type: 'marketplace',
        title: 'Listing Created',
        message: `Your product "${input.title}" has been listed successfully.`,
        relatedId: product[0].id,
      });

      return product[0];
    }),

  // Update product
  update: sellerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        data: insertProductSchema.partial(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify ownership
      const product = await db
        .select()
        .from(products)
        .where(and(eq(products.id, input.id), eq(products.sellerId, ctx.user.id)))
        .limit(1);

      if (!product[0]) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only update your own listings',
        });
      }

      const updated = await db
        .update(products)
        .set({
          ...input.data,
          updatedAt: new Date(),
          price: input.data.price ? input.data.price * 100 : undefined,
        })
        .where(eq(products.id, input.id))
        .returning();

      return updated[0];
    }),

  // Delete/Deactivate product
  delete: sellerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const product = await db
        .select()
        .from(products)
        .where(and(eq(products.id, input.id), eq(products.sellerId, ctx.user.id)))
        .limit(1);

      if (!product[0]) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Product not found or not yours',
        });
      }

      await db
        .update(products)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(products.id, input.id));

      return { success: true };
    }),

  // Get seller's products
  getMySales: sellerProcedure.query(async ({ ctx }) => {
    const items = await db
      .select()
      .from(products)
      .where(eq(products.sellerId, ctx.user.id))
      .orderBy(desc(products.createdAt));

    return items;
  }),

  // Contact seller
  contactSeller: onboardedProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        message: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Get product and seller
      const product = await db
        .select({
          id: products.id,
          title: products.title,
          sellerId: products.sellerId,
        })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.isActive, true)))
        .limit(1);

      if (!product[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Product not found',
        });
      }

      if (product[0].sellerId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot contact yourself',
        });
      }

      // Get or create conversation
      const conversation = await db
        .select()
        .from(conversations)
        .where(
          and(
            or(
              and(
                eq(conversations.user1Id, ctx.user.id),
                eq(conversations.user2Id, product[0].sellerId)
              ),
              and(
                eq(conversations.user1Id, product[0].sellerId),
                eq(conversations.user2Id, ctx.user.id)
              )
            ),
            eq(conversations.productId, input.productId)
          )
        )
        .limit(1);

      let convId: number;
      if (conversation[0]) {
        convId = conversation[0].id;
      } else {
        const [smallerId, largerId] =
          ctx.user.id < product[0].sellerId
            ? [ctx.user.id, product[0].sellerId]
            : [product[0].sellerId, ctx.user.id];

        const newConv = await db
          .insert(conversations)
          .values({
            user1Id: smallerId,
            user2Id: largerId,
            productId: input.productId,
          })
          .returning();
        convId = newConv[0].id;
      }

      // Send message
      const message = await db
        .insert(messages)
        .values({
          conversationId: convId,
          senderId: ctx.user.id,
          content: input.message,
        })
        .returning();

      // Update conversation last message time
      await db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, convId));

      // Create notification for seller
      await db.insert(notifications).values({
        userId: product[0].sellerId,
        type: 'message',
        title: 'New Message',
        message: `${ctx.user.name} sent a message about "${product[0].title}"`,
        relatedId: convId,
      });

      return { conversationId: convId, message: message[0] };
    }),

  // Product categories
  getCategories: protectedProcedure.query(async () => {
    const categories = await db
      .selectDistinct({ category: products.category })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(products.category);

    return categories.map((c) => c.category).filter(Boolean);
  }),

  // Add product review
  addReview: onboardedProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        rating: z.number().min(1).max(5),
        comment: z.string().min(1).max(1000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user purchased this product (simplified)
      const purchaseExists = await db
        .select()
        .from(conversations)
        .where(
          and(
            or(
              eq(conversations.user1Id, ctx.user.id),
              eq(conversations.user2Id, ctx.user.id)
            ),
            eq(conversations.productId, input.productId)
          )
        )
        .limit(1);

      if (!purchaseExists[0]) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only review products you have purchased',
        });
      }

      // Check if already reviewed
      const existingReview = await db
        .select()
        .from(productReviews)
        .where(
          and(
            eq(productReviews.productId, input.productId),
            eq(productReviews.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (existingReview[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'You have already reviewed this product',
        });
      }

      // Add review
      await db.insert(productReviews).values({
        productId: input.productId,
        userId: ctx.user.id,
        rating: input.rating,
        comment: input.comment,
      });

      // Update product rating
      const reviews = await db
        .select()
        .from(productReviews)
        .where(eq(productReviews.productId, input.productId));

      const avgRating =
        reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

      await db
        .update(products)
        .set({
          rating: avgRating,
          reviewCount: reviews.length,
        })
        .where(eq(products.id, input.productId));

      return { success: true };
    }),
});