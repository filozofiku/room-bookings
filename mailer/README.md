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
4. Te Actions → Send reservation emails → Run workflow, përdorni `check` për
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

## Njoftimet për aktivitetet publike

Kodi mbështet dërgimin për të gjitha rezervimet `isPublic: true`, pavarësisht
krijuesit ose sallës. Lista e marrësve ruhet në dokumentin privat
`mailSettings/publicEvents`; nuk botohet në GitHub ose në shfletues.
Për ta përditësuar, përdorni:

```
node scripts/configure-public-event-emails.mjs 'Emails for public events.txt'
node scripts/configure-public-event-emails.mjs 'Emails for public events.txt' --apply
```

Rregullat e reja duhen publikuar para përdorimit. Modaliteti `check-public` i
workflow-t kontrollon konfigurimin dhe numëron ngjarjet për njoftim pa dërguar email.
Dërgimi publik është i ndarë nga ai i anulimeve: kërkon repository variable
`PUBLIC_EVENT_EMAIL_ENABLED=true`. Kufizimi i planifikimit është pranuar dhe shfaqet në formularin e rezervimit.

Përmbledhja javore përgatitet çdo të hënë në 08:00 sipas `Europe/Tirane`,
për aktivitetet publike të javës e hënë–e diel (përfshirë të hënën në mëngjes).
Nuk ka më njoftime individuale 48 orë para aktivitetit. Ndryshimet sezonale të
orës respektohen. Worker-i i minutës fillon dërgimin në ekzekutimin e parë pas
08:00; Google/GitHub dhe kuotat mund ta vonojnë. Nëse e hëna humbet plotësisht,
nuk krijohet përmbledhje e re në mes të javës. Një javë pa aktivitete merr email
që e thotë qartë këtë.

`publicEventWeeks/{YYYY-MM-DD}` ruan listën e aktiviteteve një herë. Aktivitetet e
shtuara pas përgatitjes nuk krijojnë email shtesë. Para çdo dërgimi lexohen sërish
hollësitë: aktivitetet e anuluara, të bëra jo publike ose të zhvendosura jashtë
javës përjashtohen. `publicEventDeliveries` ruan një rezultat për çdo çift
javë–marrës, me `weekStart` dhe `bookingIds`. Marrësit `sent` nuk ridërgohen;
dështimet riprovohen deri në pesë herë dhe vetëm deri në fund të javës.
Marrësit marrin email veçmas. SMTP/MailApp nuk garantojnë saktësisht një dërgim
nëse procesi ndalet mes pranimit të emailit dhe ruajtjes së statusit.

Çdo aktivitet përmban lidhjen ekzistuese të Google Calendar Sync dhe URL-në e
abonimit live për Apple Calendar / Outlook. Lidhjet përdorin ID-në e rezervimit;
ndryshimet dhe anulimet pasqyrohen nga shërbimet ekzistuese të kalendarit.

Çdo email përmban një lidhje personale te `unsubscribe.html`, me token të
rastësishëm në fragmentin e URL-së. Hapja nuk ndryshon asgjë; marrësi klikon
“Çregjistrohu” pa hyrë në llogari. Faqja nuk përmban analitikë dhe nuk shfaq
adresën e emailit. Rregullat lejojnë vetëm çregjistrimin me tokenin e saktë;
lista, adresat dhe tokenët nuk mund të lexohen publikisht.
`publicEventRecipients` ruan preferencën private; rifutja e listës së marrësve
nuk e rivendos abonimin. Preferenca kontrollohet përsëri menjëherë para dërgimit.
Çregjistrimi ndal vetëm emailat javore publike, jo njoftimet personale për rezervime.
Emaili që është pranuar tashmë për dërgim nuk mund të tërhiqet.

Aktivizimi kërkon publikimin e faqes së re, rregullave dhe kodit të rindërtuar të
Apps Script: shihni [hapat e përditësimit](../apps-script/README.md#weekly-public-event-digests).
Mos aktivizoni të dy planifikuesit njëkohësisht. Historia e vjetër për aktivitetet
individuale ruhet; worker-i i ri nuk e ripërpunon.

## Njoftimet për ndryshimin e rezervimeve

Worker-i lexon edhe `modificationNotifications` me status `pending`, `retrying`
ose `sending`. Për çdo version të ndryshuar nga një përdorues tjetër, i dërgon
pronarit origjinal një email me vlerat para/pas ndryshimit dhe hollësitë e reja.
Marrësi merret nga profili privat i pronarit. Regjistrat `recorded` për ndryshimet
e rezervimit të vet nuk përpunohen. Riprovimi dhe bllokimi kundër dërgimeve të
njëkohshme përdorin të njëjtin mekanizëm si emaili i anulimit.

### Statusi dhe riprovimi nga aplikacioni

Te “Statusi i njoftimeve me email”, përdoruesit shohin njoftimet për rezervimet
ose kërkesat e tyre. Përdoruesit me `canCancelAll` shohin të gjitha njoftimet
si dhe numërimet e dërgimeve për aktivitetet publike. Seksioni ngarkohet kur
hapet; butoni “Rifreskoni statusin” lexon gjendjen aktuale.

“Dërguar” nënkupton pranim nga SMTP, jo konfirmim të mbërritjes në inbox.
Vetëm njoftimet `failed` mund të riprovohen nga administratorët: një transaksion
vendos `pending`, rivendos numrin e përpjekjeve dhe regjistron
`retryRequestedBy` / `retryRequestedAt`. Përmbajtja dhe marrësit nuk ndryshohen.
Njoftimet e dërguara ose në proces nuk mund të rivendosen. Worker-i ekzistues
përpunon riprovimet në ekzekutimin vijues; butoni nuk garanton dërgim të menjëhershëm.
Dërgimet publike shfaqen sipas javës dhe riprovimet ndalojnë në fund të javës.
Marrësit e çregjistruar përjashtohen nga numërimet dhe dërgimet e reja.
