---
title: Managing Events
category: Events
categoryOrder: 3
order: 0
description: Create events, manage ticket sales, check people in, and track performance
access: public
---

# Managing events

## Create an event

1. Open your Community Admin dashboard and go to the **Events** tab
2. Click **New Event**
3. Fill in the details: title, date, time, location, and description
4. Set up ticket tiers with pricing and capacity
5. Choose the event's visibility
6. Save as draft or publish immediately

If you save as a draft, the event won't be visible to anyone until you publish.

## Event visibility

Who can see and buy tickets depends on the visibility you set:

| Visibility            | Who can see it                        | Who can buy tickets          |
| --------------------- | ------------------------------------- | ---------------------------- |
| **Private**           | Vetted members only                   | Vetted members only          |
| **Public (viewable)** | Anyone, including signed-out visitors | Vetted members only          |
| **Public**            | Anyone                                | Anyone — no vetting required |

## Event lifecycle

Events have three states: draft, published, and cancelled.

A draft is just for you — nobody else can see it. Publish when you're ready and the event goes live according to your visibility setting, tickets on sale. If you need to cancel, the event gets pulled from public pages (existing ticket holders can still see the cancellation, but no new sales happen).

Cancelled events stick around in your admin dashboard for reference. They don't disappear — they just stop being public.

## The management page

Once an event exists, click into it from the Events tab to open the management page. This is where you run the event day-to-day.

The page has a payout status banner at the top (for paid Stripe events) and five tabs:

The **Analytics** tab shows ticket sales over time, revenue breakdown by tier, and how much capacity is left.

**Buyers** lists everyone who bought a ticket — name, email, tier, payment status. This is also where you issue refunds — select a ticket, hit refund, done. See [Refunds](./refunds.md).

**Guests** is your manual door list. Anyone you've added outside of ticket sales shows up here.

**Resale** shows active resale listings so you can keep an eye on how many tickets are circulating.

And **Email** lets you blast all ticket holders. Venue change? Schedule update? Pre-event hype? Send it from here.

## Check-in

Use the Scanner feature to check people in at the door. Scan the QR code on each person's ticket and the system verifies it in real time. Each ticket can only be scanned once.

You can assign door staff to handle scanning without giving them full admin access. See [Team management](./team-management.md) for how to set that up.

## Payout status

For events using Stripe, the management page shows a payout banner near the top:

- Before the event: a note about the 3-day post-event hold
- After the event: the date your payout is scheduled
- Once initiated: a confirmation that the transfer is on its way
- When complete: a green banner with the payout date

See [Payout schedule](./payout-schedule.md) for timing and what can delay things.
