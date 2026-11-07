# Live calendar subscriptions

This is a separate, read-only Apps Script web app. It serves one event per subscription. It fetches only anonymously readable `publicBookings`, `periods`, `rooms` and `calendarDays` documents and the published `calendar-classes.json`. It never reads private reservations, student addresses, mail settings, OAuth tokens or the existing email worker. It sends no emails and needs no Firebase credentials or calendar access.

## Deploy once

1. Open https://script.google.com/ and create a **new project** named **Faculty calendar subscriptions**. Keep the email-worker project separate.
2. Replace the new project's `Code.gs` contents with **[Calendar.gs](Calendar.gs)** from this folder. This file is already built: paste the complete contents.
3. Save. Choose **Deploy → New deployment → Web app**.
4. Set **Execute as: Me** and **Who has access: Anyone** (including people who are not signed in). A domain-only or signed-in-only endpoint cannot be fetched by Google Calendar. If your university account does not offer anonymous access, ask its administrator to allow it or use an account that does.
5. Click **Deploy**, authorize fetching external public data, and copy the URL ending in **`/exec`**. Send that URL back so it can be configured and verified on both websites. Do not use a `/dev` URL.

There is no trigger to install. `doGet` runs when Google Calendar refreshes a subscription. To update the service later, paste the rebuilt file, then choose **Deploy → Manage deployments → Edit → New version → Deploy**, preserving the existing `/exec` URL.

## Website configuration and verification

Set the same `endpoint` in `public-schedule/calendar-config.json` and `public/calendar-config.json`, then publish the public and booking sites. Confirm an anonymous request to `ENDPOINT?class=class-1` returns `BEGIN:VCALENDAR`, `UID:class-1@filozofiku.github.io`, a weekly RRULE and an inclusive 31 December 2026 limit. A reservation uses `ENDPOINT?booking=RESERVATION_ID`, with no RRULE. A deleted reservation returns a valid empty calendar; temporary upstream errors fail the request instead of accidentally clearing subscribed calendars.

The Google link subscribes to the feed; the readonly address provides a fallback for **Other calendars → From URL** on Google Calendar's desktop website. Google controls refresh timing, so updates are not instantaneous. Previously imported/downloaded events are independent copies and must be removed manually and replaced with subscriptions. The `.ics` download remains an explicitly labelled snapshot.

## Keeping official classes current

The catalog uses stable FET activity IDs. After changing the official exports or CSV, run:

```
node scripts/build-calendar-classes.mjs /path/to/public-site data/timetable.csv
```

Publish `calendar-classes.json` alongside the HTML exports. The public-site deployment workflow also rebuilds this catalog from the HTML on every push, so subsequent room/time changes are reflected automatically. Use the CSV build when changing class metadata, preserving original FET activity IDs. With a CSV, FET activity IDs remain stable through changes to titles, teachers, groups, rooms and times. Without a CSV, the builder reconciles the existing catalog with changed HTML, matching unchanged classes first and uniquely identifiable moved classes next. Never reuse FET activity IDs for unrelated classes within a semester. Keep `semesterStart`, `semesterEnd`, and holidays consistent with the semester configuration when starting a new term.

Classes recur at the same Europe/Tirane wall time every week from the start of the semester through 2026-12-31, excluding 2026-12-25 and any dates where the public `calendarDays` document disables teaching. Explicit timezone rules handle daylight saving. Reservations are single events; changes are fetched live from Firestore. Deleting a class from the published catalog empties its existing feed.

## Development

```
node scripts/build-calendar-service.mjs
node --test tests/calendar-export.test.mjs tests/calendar-service.test.mjs
```

`Calendar.gs` is generated from `worker.js` and the shared calendar serializer. It deliberately has no dependency on the email Apps Script build.
