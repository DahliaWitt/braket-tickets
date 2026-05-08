import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {applicationsByOrganizerQuery} from '../applications/loaders';

type ApplicationAnswers = Doc<'applications'>['answers'];
type CommunityVettingQuestions = Doc<'organizers'>['vettingQuestions'];
type ApplicationQueryDb = Pick<QueryCtx['db'], 'query'>;
type ApplicationPatchDb = Pick<MutationCtx['db'], 'query' | 'patch'>;

export function getRemovedVettingQuestionIds(
  previousQuestions: CommunityVettingQuestions,
  nextQuestions: CommunityVettingQuestions,
): string[] {
  const nextQuestionIds = new Set((nextQuestions ?? []).map((question) => question.id));

  return (previousQuestions ?? [])
    .map((question) => question.id)
    .filter((questionId) => !nextQuestionIds.has(questionId));
}

export function stripRemovedAnswerKeys(
  answers: ApplicationAnswers,
  removedQuestionIds: ReadonlySet<string>,
): ApplicationAnswers | null {
  let changed = false;
  const cleanedAnswers: ApplicationAnswers = {};

  for (const [key, value] of Object.entries(answers)) {
    if (removedQuestionIds.has(key)) {
      changed = true;
      continue;
    }
    cleanedAnswers[key] = value;
  }

  return changed ? cleanedAnswers : null;
}

export async function cleanupRemovedVettingQuestionAnswers(
  db: ApplicationPatchDb,
  organizerId: Id<'organizers'>,
  removedQuestionIds: ReadonlySet<string>,
): Promise<number> {
  let cleanedCount = 0;

  for await (const application of applicationsByOrganizerQuery(db, organizerId)) {
    const cleanedAnswers = stripRemovedAnswerKeys(
      application.answers,
      removedQuestionIds,
    );
    if (!cleanedAnswers) continue;

    await db.patch('applications', application._id, {answers: cleanedAnswers});
    cleanedCount += 1;
  }

  return cleanedCount;
}

export async function countVettingQuestionUsage(
  db: ApplicationQueryDb,
  organizerId: Id<'organizers'>,
  questionIds: ReadonlySet<string>,
): Promise<{
  affectedApplicationCount: number;
  totalOrphanedKeys: number;
}> {
  let affectedApplicationCount = 0;
  let totalOrphanedKeys = 0;

  for await (const application of applicationsByOrganizerQuery(db, organizerId)) {
    let orphanedKeyCount = 0;

    for (const answerKey of Object.keys(application.answers)) {
      if (questionIds.has(answerKey)) {
        orphanedKeyCount += 1;
      }
    }

    if (orphanedKeyCount > 0) {
      affectedApplicationCount += 1;
      totalOrphanedKeys += orphanedKeyCount;
    }
  }

  return {affectedApplicationCount, totalOrphanedKeys};
}
