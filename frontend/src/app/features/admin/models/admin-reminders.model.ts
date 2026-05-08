import type { FunctionReturnType } from 'convex/server';
import type { api } from '@convex/_generated/api';

export type VettingReminderAudience = FunctionReturnType<
  typeof api.communities.management.reminders.getVettingReminderAudience
>;

export type VettingReminderSendResult = FunctionReturnType<
  typeof api.communities.management.reminders.sendVettingReminder
>;
