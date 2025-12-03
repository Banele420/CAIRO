import { pgTable, serial, text, varchar, integer, boolean, timestamp, decimal, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

// Users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  openId: varchar('open_id', { length: 255 }).unique().notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  loginMethod: varchar('login_method', { length: 50 }).default('manus'),
  role: varchar('role', { length: 20 }).default('student'),
  campus: varchar('campus', { length: 100 }),
  residence: varchar('residence', { length: 100 }),
  degree: varchar('degree', { length: 200 }),
  yearOfStudy: integer('year_of_study'),
  hasStudentBusiness: boolean('has_student_business').default(false),
  isOnboarded: boolean('is_onboarded').default(false),
  isSellerSubscribed: boolean('is_seller_subscribed').default(false),
  sellerSubscriptionExpiry: timestamp('seller_subscription_expiry'),
  avatarUrl: text('avatar_url'),
  phone: varchar('phone', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastSignedIn: timestamp('last_signed_in').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  products: many(products),
  conversationsAsUser1: many(conversations, { relationName: 'user1' }),
  conversationsAsUser2: many(conversations, { relationName: 'user2' }),
  messages: many(messages),
  notifications: many(notifications),
  forumPosts: many(forumPosts),
  forumComments: many(forumComments),
  eventRSVPs: many(eventRSVPs),
  lostFoundPosts: many(lostFoundPosts),
  studyGroupMembers: many(studyGroupMembers),
  jobApplications: many(jobApplications),
  paymentSubscriptions: many(paymentSubscriptions),
}));

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectUserSchema = createSelectSchema(users);

// Marketplace products
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  sellerId: integer('seller_id').notNull().references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }).notNull(),
  price: integer('price').notNull(), // in cents
  currency: varchar('currency', { length: 3 }).default('ZAR'),
  condition: varchar('condition', { length: 50 }).default('new'),
  images: jsonb('images').default([]),
  location: varchar('location', { length: 255 }),
  deliveryOption: varchar('delivery_option', { length: 100 }),
  isActive: boolean('is_active').default(true),
  isNegotiable: boolean('is_negotiable').default(false),
  viewCount: integer('view_count').default(0),
  rating: decimal('rating', { precision: 3, scale: 2 }).default('0.00'),
  reviewCount: integer('review_count').default(0),
  tags: jsonb('tags').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const productsRelations = relations(products, ({ one, many }) => ({
  seller: one(users, {
    fields: [products.sellerId],
    references: [users.id],
  }),
  conversations: many(conversations),
  reviews: many(productReviews),
}));

// Real-time messaging
export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  user1Id: integer('user1_id').notNull().references(() => users.id),
  user2Id: integer('user2_id').notNull().references(() => users.id),
  productId: integer('product_id').references(() => products.id),
  lastMessageAt: timestamp('last_message_at').defaultNow(),
  user1Deleted: boolean('user1_deleted').default(false),
  user2Deleted: boolean('user2_deleted').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user1: one(users, {
    fields: [conversations.user1Id],
    references: [users.id],
    relationName: 'user1',
  }),
  user2: one(users, {
    fields: [conversations.user2Id],
    references: [users.id],
    relationName: 'user2',
  }),
  product: one(products, {
    fields: [conversations.productId],
    references: [products.id],
  }),
  messages: many(messages),
}));

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => conversations.id),
  senderId: integer('sender_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  isRead: boolean('is_read').default(false),
  readAt: timestamp('read_at'),
  attachments: jsonb('attachments').default([]),
  createdAt: timestamp('created_at').defaultNow(),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
}));

// Events system
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  organizerId: integer('organizer_id').notNull().references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }).notNull(),
  location: varchar('location', { length: 255 }).notNull(),
  lat: decimal('lat', { precision: 10, scale: 8 }),
  lng: decimal('lng', { precision: 11, scale: 8 }),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  capacity: integer('capacity'),
  coverImage: text('cover_image'),
  isPromoted: boolean('is_promoted').default(false),
  isCancelled: boolean('is_cancelled').default(false),
  price: integer('price').default(0), // in cents
  tags: jsonb('tags').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const eventRSVPs = pgTable('event_rsvps', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id').notNull().references(() => events.id),
  userId: integer('user_id').notNull().references(() => users.id),
  status: varchar('status', { length: 20 }).default('going'), // going, maybe, not_going
  checkedIn: boolean('checked_in').default(false),
  checkedInAt: timestamp('checked_in_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Forum system
export const forumPosts = pgTable('forum_posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').notNull().references(() => users.id),
  category: varchar('category', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  isAnonymous: boolean('is_anonymous').default(false),
  isPinned: boolean('is_pinned').default(false),
  isLocked: boolean('is_locked').default(false),
  viewCount: integer('view_count').default(0),
  upvoteCount: integer('upvote_count').default(0),
  downvoteCount: integer('downvote_count').default(0),
  commentCount: integer('comment_count').default(0),
  tags: jsonb('tags').default([]),
  attachments: jsonb('attachments').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const forumComments = pgTable('forum_comments', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => forumPosts.id),
  authorId: integer('author_id').notNull().references(() => users.id),
  parentId: integer('parent_id').references(() => forumComments.id),
  content: text('content').notNull(),
  isAnonymous: boolean('is_anonymous').default(false),
  upvoteCount: integer('upvote_count').default(0),
  downvoteCount: integer('downvote_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Study hub
export const studyGroups = pgTable('study_groups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  courseCode: varchar('course_code', { length: 50 }),
  campus: varchar('campus', { length: 100 }),
  maxMembers: integer('max_members'),
  isPublic: boolean('is_public').default(true),
  meetingSchedule: jsonb('meeting_schedule'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const studyGroupMembers = pgTable('study_group_members', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id').notNull().references(() => studyGroups.id),
  userId: integer('user_id').notNull().references(() => users.id),
  role: varchar('role', { length: 20 }).default('member'), // admin, member
  joinedAt: timestamp('joined_at').defaultNow(),
});

export const studyResources = pgTable('study_resources', {
  id: serial('id').primaryKey(),
  uploaderId: integer('uploader_id').notNull().references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  courseCode: varchar('course_code', { length: 50 }),
  resourceType: varchar('resource_type', { length: 50 }).notNull(), // notes, past_paper, video
  fileUrl: text('file_url').notNull(),
  fileSize: integer('file_size'),
  downloadCount: integer('download_count').default(0),
  isApproved: boolean('is_approved').default(false),
  tags: jsonb('tags').default([]),
  createdAt: timestamp('created_at').defaultNow(),
});

// Career & Jobs
export const jobListings = pgTable('job_listings', {
  id: serial('id').primaryKey(),
  employerId: integer('employer_id').notNull().references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  company: varchar('company', { length: 255 }).notNull(),
  description: text('description').notNull(),
  requirements: text('requirements'),
  location: varchar('location', { length: 255 }),
  jobType: varchar('job_type', { length: 50 }), // full_time, part_time, internship, remote
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: varchar('salary_currency', { length: 3 }).default('ZAR'),
  applicationDeadline: timestamp('application_deadline'),
  isActive: boolean('is_active').default(true),
  viewCount: integer('view_count').default(0),
  applicationCount: integer('application_count').default(0),
  tags: jsonb('tags').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const jobApplications = pgTable('job_applications', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull().references(() => jobListings.id),
  applicantId: integer('applicant_id').notNull().references(() => users.id),
  coverLetter: text('cover_letter'),
  resumeUrl: text('resume_url'),
  status: varchar('status', { length: 20 }).default('pending'), // pending, reviewed, accepted, rejected
  statusUpdatedAt: timestamp('status_updated_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Lost & Found
export const lostFoundPosts = pgTable('lost_found_posts', {
  id: serial('id').primaryKey(),
  posterId: integer('poster_id').notNull().references(() => users.id),
  type: varchar('type', { length: 20 }).notNull(), // lost, found
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  itemCategory: varchar('item_category', { length: 100 }),
  locationLostFound: varchar('location_lost_found', { length: 255 }),
  dateLostFound: timestamp('date_lost_found'),
  images: jsonb('images').default([]),
  contactInfo: jsonb('contact_info').default({}),
  isResolved: boolean('is_resolved').default(false),
  resolvedAt: timestamp('resolved_at'),
  claimedById: integer('claimed_by_id').references(() => users.id),
  viewCount: integer('view_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Music & Creative
export const musicProfiles = pgTable('music_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  artistName: varchar('artist_name', { length: 255 }),
  genre: varchar('genre', { length: 100 }),
  bio: text('bio'),
  spotifyUrl: text('spotify_url'),
  soundcloudUrl: text('soundcloud_url'),
  youtubeUrl: text('youtube_url'),
  followerCount: integer('follower_count').default(0),
  isVerifiedArtist: boolean('is_verified_artist').default(false),
  servicesOffered: jsonb('services_offered').default([]), // ['dj', 'production', 'lessons']
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Notifications
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  type: varchar('type', { length: 50 }).notNull(), // marketplace, event, forum, message, system
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').default(false),
  relatedId: integer('related_id'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// Payments & Subscriptions
export const paymentSubscriptions = pgTable('payment_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  plan: varchar('plan', { length: 50 }).notNull(), // premium, seller_pro
  status: varchar('status', { length: 20 }).notNull(), // active, cancelled, expired
  paystackSubscriptionCode: varchar('paystack_subscription_code', { length: 100 }),
  paystackCustomerCode: varchar('paystack_customer_code', { length: 100 }),
  amount: integer('amount').notNull(), // in cents
  currency: varchar('currency', { length: 3 }).default('ZAR'),
  interval: varchar('interval', { length: 20 }).default('monthly'),
  startDate: timestamp('start_date').defaultNow(),
  nextBillingDate: timestamp('next_billing_date'),
  endDate: timestamp('end_date'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const paymentTransactions = pgTable('payment_transactions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  reference: varchar('reference', { length: 100 }).unique().notNull(),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).default('ZAR'),
  status: varchar('status', { length: 20 }).notNull(), // success, failed, pending
  paymentMethod: varchar('payment_method', { length: 50 }),
  description: text('description'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// Admin & Moderation
export const reportedContent = pgTable('reported_content', {
  id: serial('id').primaryKey(),
  reporterId: integer('reporter_id').notNull().references(() => users.id),
  contentType: varchar('content_type', { length: 50 }).notNull(), // product, forum_post, comment, message
  contentId: integer('content_id').notNull(),
  reason: varchar('reason', { length: 100 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('pending'), // pending, reviewed, resolved, dismissed
  resolvedById: integer('resolved_by_id').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Analytics
export const analyticsEvents = pgTable('analytics_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  pagePath: varchar('page_path', { length: 500 }),
  elementId: varchar('element_id', { length: 100 }),
  metadata: jsonb('metadata').default({}),
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Zod schemas for validation
export const createProductSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().optional(),
  category: z.string().min(1),
  price: z.number().int().min(0),
  condition: z.enum(['new', 'like_new', 'good', 'fair']).optional(),
  images: z.array(z.string().url()).optional(),
  location: z.string().optional(),
  deliveryOption: z.string().optional(),
  isNegotiable: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export const createMessageSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  receiverId: z.number().int().positive().optional(),
  productId: z.number().int().positive().optional(),
  content: z.string().min(1).max(2000),
});

export const createEventSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().optional(),
  category: z.string().min(1),
  location: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  capacity: z.number().int().positive().optional(),
  price: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
});

export const createForumPostSchema = z.object({
  category: z.string().min(1),
  title: z.string().min(3).max(255),
  content: z.string().min(1).max(10000),
  isAnonymous: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export const createJobListingSchema = z.object({
  title: z.string().min(3).max(255),
  company: z.string().min(1),
  description: z.string().min(1),
  requirements: z.string().optional(),
  location: z.string().optional(),
  jobType: z.enum(['full_time', 'part_time', 'internship', 'remote']),
  salaryMin: z.number().int().positive().optional(),
  salaryMax: z.number().int().positive().optional(),
  applicationDeadline: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;
export type SelectProduct = typeof products.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;
export type SelectConversation = typeof conversations.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;
export type SelectMessage = typeof messages.$inferSelect;