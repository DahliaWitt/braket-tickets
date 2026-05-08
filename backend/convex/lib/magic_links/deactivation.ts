import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {collectMatchingInQuery} from '../query_scan';

type MagicLinkMutationCtx = MutationCtx;

type MagicLinkDoc = Doc<'magic_links'>;

function isDeactivatableLink(link: MagicLinkDoc): boolean {
  return !link.deletedAt && link.status === 'active';
}

async function deactivateMagicLink(
  ctx: MagicLinkMutationCtx,
  link: MagicLinkDoc,
  now = Date.now(),
): Promise<boolean> {
  if (!isDeactivatableLink(link)) return false;

  await ctx.db.patch('magic_links', link._id, {
    status: 'disabled',
    deletedAt: now,
  });
  return true;
}

export async function deactivateActiveMagicLinksForCreator(
  ctx: MagicLinkMutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    creatorId: Id<'users'>;
    now?: number;
  },
): Promise<number> {
  const activeLinks = await collectMatchingInQuery(
    ctx.db
      .query('magic_links')
      .withIndex('by_organizerId_and_createdBy_and_status', (q) =>
        q
          .eq('organizerId', args.organizerId)
          .eq('createdBy', args.creatorId)
          .eq('status', 'active'),
      ),
    (link) => !link.deletedAt,
  );

  const now = args.now ?? Date.now();
  const results = await Promise.all(
    activeLinks.map((link) => deactivateMagicLink(ctx, link, now)),
  );
  return results.filter(Boolean).length;
}
