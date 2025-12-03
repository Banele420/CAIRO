import { createTRPCRouter } from '../_core/trpc';
import { authRouter } from './auth';
import { marketplaceRouter } from './marketplace';
import { messagingRouter } from './messaging';
import { profileRouter } from './profile';
import { eventsRouter } from './events';
import { forumRouter } from './forum';
import { careerRouter } from './career';
import { studyhubRouter } from './studyhub';
import { lostfoundRouter } from './lostfound';
import { musicRouter } from './music';
import { adminRouter } from './admin';
import { aiSearchRouter } from './aiSearch';
import { paymentsRouter } from './payments';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  marketplace: marketplaceRouter,
  messaging: messagingRouter,
  profile: profileRouter,
  events: eventsRouter,
  forum: forumRouter,
  career: careerRouter,
  studyhub: studyhubRouter,
  lostfound: lostfoundRouter,
  music: musicRouter,
  admin: adminRouter,
  aiSearch: aiSearchRouter,
  payments: paymentsRouter,
});

export type AppRouter = typeof appRouter;