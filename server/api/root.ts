import { artifactRouter } from '@/server/api/routers/artifact';
import { chatRouter } from '@/server/api/routers/chat';
import { libraryRouter } from '@/server/api/routers/library';
import { messageRouter } from '@/server/api/routers/message';
import { modelRouter } from '@/server/api/routers/model';
import { planRouter } from '@/server/api/routers/plan';
import { pricingRouter } from '@/server/api/routers/pricing';
import { promptRouter } from '@/server/api/routers/prompt';
import { providerRouter } from '@/server/api/routers/provider';
import { quotaRouter } from '@/server/api/routers/quota';
import { settingsRouter } from '@/server/api/routers/settings';
import { shareRouter } from '@/server/api/routers/share';
import { usageRouter } from '@/server/api/routers/usage';
import { userRouter } from '@/server/api/routers/user';
import { createCallerFactory, createTRPCRouter } from '@/server/api/trpc';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  chat: chatRouter,
  message: messageRouter,
  artifact: artifactRouter,
  library: libraryRouter,
  share: shareRouter,
  // Admin console routers
  provider: providerRouter,
  model: modelRouter,
  prompt: promptRouter,
  settings: settingsRouter,
  user: userRouter,
  pricing: pricingRouter,
  quota: quotaRouter,
  usage: usageRouter,
  plan: planRouter
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
