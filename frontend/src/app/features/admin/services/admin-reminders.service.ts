import {Injectable} from '@angular/core';
import { injectConvex } from 'convex-angular';
import {api} from '@convex/_generated/api';
import type {
  VettingReminderAudience,
  VettingReminderSendResult,
} from '../models/admin-reminders.model';

@Injectable({
  providedIn: 'root',
})
export class AdminRemindersService {
  private convex = injectConvex();

  async getVettingReminderAudience(): Promise<VettingReminderAudience> {
    return this.convex.query(api.communities.management.reminders.getVettingReminderAudience, {});
  }

  async sendVettingReminder(
    subject: string,
    message: string,
  ): Promise<VettingReminderSendResult> {
    return this.convex.mutation(api.communities.management.reminders.sendVettingReminder, {
      subject,
      message,
    });
  }
}
