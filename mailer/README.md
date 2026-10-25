# Njoftimet e anulimit pa Blaze

Anulimi i rezervimit të një përdoruesi tjetër kërkon arsye (deri në 2000 karaktere).
Rezervimi, zënia dhe publikimi hiqen në një transaksion që ruan edhe njoftimin privat.
Anulimi i rezervimit të vet nuk krijon email dhe nuk kërkon arsye.

GitHub Actions kontrollon njoftimet çdo pesë minuta; planifikimi mund të vonohet.
Nuk nevojiten Cloud Functions ose plani Blaze. Workflow përdor runner standard në
repository publik. GitHub mund të çaktivizojë planifikimin pas 60 ditësh pa aktivitet
në repository; kontrolloni Actions dhe riaktivizojeni kur nevojitet.

## Konfigurimi

1. Publikoni rregullat: `firebase deploy --only firestore:rules --project filozofiku`.
2. Me kredenciale administrative lokale, ekzekutoni
   `node scripts/configure-cancellation-worker.mjs --apply`.
   Kjo plotëson emailin e përdoruesve nga Firebase Auth dhe ruan në GitHub sekretin
   `CANCELLATION_FIREBASE_REFRESH_TOKEN` për një përdorues teknik të kufizuar.
   Çelësi administrativ nuk transferohet. Përdoruesi teknik lexon njoftimet dhe
   emailin e pronarit dhe ndryshon vetëm statusin e dërgimit; nuk mund të rezervojë,
   anulojë ose ndryshojë arsyen/marrësin.
3. Nga llogaria `zzha.filozofik@uni-pr.edu`, krijoni një Google App Password te
   https://myaccount.google.com/apppasswords dhe ruajeni drejtpërdrejt te
   https://github.com/filozofiku/room-bookings/settings/secrets/actions/new
   me emrin `CANCELLATION_SMTP_PASSWORD`. Mos e vendosni në chat, Git ose frontend.
   Nëse politika Workspace nuk e lejon, kërkohet autorizim tjetër nga administratori.
4. Te Actions → Send cancellation emails → Run workflow, përdorni `check` për
   lidhjen me Firebase dhe `verify-smtp` për Gmail. Këto nuk dërgojnë email.
5. Vetëm pasi kontrollet kalojnë, vendosni repository variable
   `CANCELLATION_EMAIL_ENABLED` në `true`. Modaliteti manual `send` dërgon njoftimet
   në pritje edhe kur planifikimi është i çaktivizuar.

Emaili nga `zzha.filozofik@uni-pr.edu`, me Gmail STARTTLS në portin 587, përmban
në shqip titullin, datën, intervalin, sallën dhe arsyen e anulimit. Marrësi merret
nga `users/{booking.ownerUid}.email`, fushë që shkruhet vetëm nga administratori.
Miratimi i përdoruesve të rinj përmes `scripts/manage-booking-user.mjs` e ruan këtë
fushë; pas ndryshimit të emailit në Auth, përsëritni konfigurimin për sinkronizim.

## Dështimet

Statuset janë `pending → sending → sent`, ose `retrying` / `failed`.
Pas pesë tentativave ose kur mungon marrësi, njoftimi shënohet `failed`.
Pas korrigjimit të shkakut përdorni `node scripts/requeue-cancellation-notifications.mjs`
për kontroll dhe shtoni `--apply` për riprovim. Njoftimet `pending` merren automatikisht.

Një bllokim kohor dhe shkrimi kushtor pengojnë punëtorët paralelë të dërgojnë të
njëjtin njoftim. SMTP nuk garanton vetëm një dërgim nëse procesi ndalet pas pranimit
të emailit dhe para ruajtjes së statusit. Riprovimet përdorin të njëjtin Message-ID.
`sent` nënkupton pranimin nga SMTP, jo garanci të mbërritjes në inbox.
Sekretet dhe arsyet nuk regjistrohen në log. Testet përdorin email të simuluar.
