# Google Calendar updates checked every five minutes

This is a **new, separate Apps Script project**, deployed as **User accessing the web app**. Each visitor authorizes it once. It creates one secondary calendar in that visitor's account, stores only the selected public activity IDs and sync state in that user's User Properties, and installs one five-minute trigger owned by that user. The trigger continues when the website is closed. A shared cache holds only public source events for at most 60 seconds; it never contains user selections, calendar IDs or tokens. Google manages its OAuth tokens; no refresh tokens are stored by the website.

It requests `calendar.app.created`, which permits managing only secondary calendars created by this app, plus external requests and trigger management. It cannot read or change the user's primary calendar. It reads only the same public timetable/reservation data as the existing feed. It sends no emails, adds no attendees, and never modifies reservations or the email worker.

## Deploy

1. Create a **new** project at https://script.google.com/, named **Faculty Google Calendar Sync**. Do not replace or reconfigure either the email worker or the existing public calendar feed.
2. Paste the complete contents of [CalendarSync.gs](CalendarSync.gs) into its `Code.gs`.
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace that file with [appsscript.json](appsscript.json) from this directory. The three explicit OAuth scopes are required; preserve them.
4. Enable the **Google Calendar API** for this project's Google Cloud project. For a default Apps Script Cloud project, adding **Services → + → Google Calendar API** enables the API. For a standard Cloud project, enable Google Calendar API in Cloud Console as well. The implementation calls the REST API and retains the explicit narrow scopes in the manifest.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as: User accessing the web app** and **Who has access: Anyone with a Google account**. Do **not** deploy it as yourself: that would put everybody's selections in your calendar. This service is deliberately different from the anonymous public feed.
6. Deploy and send the new URL ending in `/exec`. It will be stored as `syncEndpoint` in the website's `calendar-config.json`. Keep the existing `endpoint` unchanged.

For public availability beyond permitted/test accounts, configure the OAuth consent screen for the intended audience and complete any Google-required verification. External apps left in Testing have test-user restrictions and authorizations for these scopes can expire after seven days. Workspace administrators may also restrict user authorization or external access. Test with a second account before enabling the option for all visitors. Google controls deployment and consent; the website cannot bypass these requirements.

## Visitor experience

The website opens this connection page with the selected activity ID and language. After Google authorization, the visitor explicitly clicks **Connect this activity**. The app creates a separate **Fakulteti Filozofik · Orari** calendar, adds that activity immediately, and installs its five-minute check. Additional activities go into the same calendar. Official classes recur weekly through 31 December 2026; reservations remain single events.

The page lists connected activities, the last check, and any retry status. **Check for changes now** performs a check immediately. **Remove from calendar** deletes only that selected synced event and stops tracking it. **Stop all automatic updates** removes this app's trigger and selections, leaving existing calendar events in place. Connecting an activity again resumes updates. Visitors should remove older URL subscriptions themselves to avoid duplicates.

There is a 50-activity limit per account. Five minutes is the target checking interval, not a delivery guarantee: Google trigger scheduling, API failures and quotas can delay updates. Failed sources are retried without deleting existing calendar events. A rotating cursor prevents slow activities from starving later selections. Revoked permissions require reconnecting. Native API updates avoid the external calendar feed cache.

## Test and build

```
node scripts/build-calendar-sync.mjs
node --test tests/calendar-sync.test.mjs
```

`CalendarSync.gs` is generated and self-contained. Redeploy new versions using **Manage deployments → Edit → New version**, preserving its URL and **User accessing** setting. All external effects in tests are mocked. Production activation must include an actual account-authorized connect/edit/cancel test by the account owner; do not claim minute-level live synchronization before that test succeeds.

Official references: [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth), [installable triggers](https://developers.google.com/apps-script/guides/triggers/installable), and [Apps Script web-app deployment](https://developers.google.com/apps-script/guides/web).

## Update the connection screen and repair calendar visibility

Replace `Code.gs` in the **existing Faculty Google Calendar Sync project** with the latest `CalendarSync.gs` from this directory. Choose **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**. Keep the same `/exec` URL and **Execute as: User accessing the web app**. No manifest or permission changes are needed for this update. Existing user selections and calendars are retained.

Reload the connection page, then click **Connect this activity** or **Check for changes now**. These explicit actions mark the app-created calendar as selected and visible. The screen displays its actual name, ID and a direct calendar link, plus links to individual events. Look in this separate faculty calendar, rather than the account's primary calendar. The name may be shared by multiple accounts; the displayed calendar ID identifies the destination precisely.

Every synchronization now reads the Google event before trusting saved sync state. Missing events are recreated, and changed Google event versions are reconciled even if the source activity has not changed. Successful writes must return the expected event ID before they are saved as synchronized. Manual checks fetch the public source fresh. Add/remove actions have distinct confirmations, and failed operations expose error details instead of silently returning “Ready”. Older URL subscriptions and manually imported copies remain separate and must be removed individually.
