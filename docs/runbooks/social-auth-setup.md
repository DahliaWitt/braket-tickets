---
title: Social Auth Setup
category: Runbooks
order: 13
description: Incident response runbook — social auth setup
access: public
---

# Social Auth Provider Setup

This guide is for engineers who create or rotate Google and Discord OAuth credentials. It assumes access to Google Cloud Console, Discord Developer Portal, and Doppler. Use it for provider setup. Use [Auth Incidents](./auth-incidents.md) for live sign-in, callback, or verification failures.

## Confirm the callback URLs

Use these base URLs when you configure provider callbacks:

| Environment | Callback base URL                                            |
| ----------- | ------------------------------------------------------------ |
| Production  | `https://modest-impala-722.convex.site/api/auth/callback`    |
| Staging     | `https://bright-swordfish-194.convex.site/api/auth/callback` |
| Local       | `http://127.0.0.1:3211/api/auth/callback`                    |

Append the provider name to the base URL, for example `/google` or `/discord`.

## Set up Google sign-in

Before you start, confirm that you can access Google Cloud Console and create or edit OAuth credentials.

1. Create or select the Google Cloud project.
2. Open **APIs & Services -> OAuth consent screen**.
3. Configure the consent screen with the required `email`, `profile`, and `openid` scopes.
4. Open **APIs & Services -> Credentials**.
5. Create an OAuth client ID for a web application.
6. Add these redirect URIs:

```text
https://modest-impala-722.convex.site/api/auth/callback/google
https://bright-swordfish-194.convex.site/api/auth/callback/google
http://127.0.0.1:3211/api/auth/callback/google
http://localhost:3211/api/auth/callback/google
```

7. Copy the client ID and client secret.
8. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Doppler for `stg` and `prd`.
9. Run `DOPPLER_CONFIG=stg pnpm sync:env:dev` for staging and `DOPPLER_CONFIG=prd pnpm sync:env:prod` for production.

## Set up Discord sign-in

Before you start, confirm that you can access Discord Developer Portal and create or edit an application.

1. Create or select the Discord application.
2. Open **OAuth2**.
3. Add these redirect URLs:

```text
https://modest-impala-722.convex.site/api/auth/callback/discord
https://bright-swordfish-194.convex.site/api/auth/callback/discord
http://127.0.0.1:3211/api/auth/callback/discord
http://localhost:3211/api/auth/callback/discord
```

4. Copy the application ID and client secret.
5. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in Doppler for `stg` and `prd`.
6. Run `DOPPLER_CONFIG=stg pnpm sync:env:dev` for staging and `DOPPLER_CONFIG=prd pnpm sync:env:prod` for production.

## Verify the setup

Use the checks below after you add or rotate credentials:

1. Check that the target Convex deployment has the new provider values. Use Convex Dashboard or your normal `convex env list` workflow for the affected deployment.
2. Start the app locally:

```bash
pnpm dev
```

3. Open the login page and confirm that the provider buttons appear.
4. Run a full sign-in flow for the provider you changed.

## Fix common setup problems

| Symptom                                  | Likely cause                                                 | Fix                                                                         |
| ---------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Social buttons do not appear             | The client ID or secret is missing in the active environment | Check the Doppler values, then rerun the matching `pnpm sync:env:*` command |
| `Redirect URI mismatch`                  | A callback URL is missing or wrong in the provider dashboard | Add the exact callback URL for the failing environment                      |
| `Invalid client`                         | The client ID or secret is wrong                             | Copy the provider credentials again and update Doppler                      |
| It works locally but fails in production | The production callback URL is missing                       | Add the production callback URL and resync the production environment       |

## Follow the security rules

- Never commit a client secret.
- Treat Doppler as the source of truth for provider credentials.
- Rotate the credentials if you suspect exposure.
- Use separate staging and production provider apps if you want stronger isolation.
