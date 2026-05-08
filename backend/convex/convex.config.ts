import {defineApp} from 'convex/server';
import betterAuth from '@convex-dev/better-auth/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import resend from '@convex-dev/resend/convex.config.js';
import workpool from '@convex-dev/workpool/convex.config';
import migrations from '@convex-dev/migrations/convex.config';
import authz from '@djpanda/convex-authz/convex.config';
import posthog from '@posthog/convex/convex.config.js';

const app: ReturnType<typeof defineApp> = defineApp();
app.use(betterAuth);
app.use(rateLimiter);
app.use(resend);
app.use(workpool, {name: 'payoutPool'});
app.use(workpool, {name: 'stripePool'});
app.use(migrations);
app.use(authz);
app.use(posthog);

export default app;
