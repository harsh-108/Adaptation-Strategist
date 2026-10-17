# Deploy Adaptation Strategist to Google Cloud

Oct 17, 2026

One PowerShell script deploys the Google Cloud copy of the app (`adaptation-atlas-gcp`) in about 15 minutes: Cloud Run, Gemini on Vertex AI, Firestore, Firebase Hosting and, if you give it an ID, Google Analytics. Inside the free tiers it costs ₹0, but Google still needs a billing account linked.

## Before you start

- **A Google account** that can create Google Cloud projects. Company Workspace accounts sometimes block public links; see Troubleshooting.
- **A billing account.** Free means ₹0 while you stay inside the monthly free limits. Google still asks for billing to switch on Cloud Run, Cloud Build, Secret Manager and Cloud Scheduler, and Vertex AI Gemini has no free tier. Use the $300 new-account trial (90 days, it does not charge your card when it ends) or hackathon credits.
- **A Windows PC** with PowerShell, Node.js (for the Firebase CLI) and the folder `D:\code\AI Builder Cup\adaptation-atlas-gcp`.
- **Your `.env` file** in that folder. The script copies its keys into Secret Manager; the file itself is never uploaded.
- **About 15 minutes.** The first build takes 5 to 8 minutes.

What the script creates in your project:

| Piece | Google service | What it does |
| --- | --- | --- |
| Web app and API | Cloud Run service `atlas-web`, Mumbai (`asia-south1`) | Runs the app with the existing `Procfile` |
| Gemini | Vertex AI | AI answers, signed in by the app's service account, no API key |
| Keys | Secret Manager | Holds the keys from `.env` |
| Public address | Firebase Hosting `PROJECT.web.app` | Passes every page and API call to the Cloud Run service |
| Decision records | Firestore database (Native mode, same region) | Approval requests, the hash-chained audit trail, meter summaries and assumptions |
| Team records | Cloud Storage bucket `PROJECT-atlas` | Keeps sites, alerts and hub edits across restarts |
| Usage analytics | Google Analytics 4 (the Firebase project's property) | Counts screens and features used, only for visitors who allow it |
| Alert checks | Cloud Scheduler job `atlas-alerts` | Calls the app every 30 minutes |
| Identity | Service account `atlas-run` | Gives the app only the access it needs |

## What we swapped

Sixteen parts of the original app now run on Google services. Every swap keeps the original source as a fallback, so the app still works with no Google keys. The original folder `adaptation-atlas` is untouched; all changes are in the copy `adaptation-atlas-gcp`.

| # | Part | Before (original app) | After (Google) | Files changed | If Google is off or fails |
| --- | --- | --- | --- | --- | --- |
| 1 | Hosting | Laptop or AWS EC2 with systemd and nginx | Cloud Run, deployed by one script | `deploy/gcp/deploy.ps1`, `.python-version`, `.gcloudignore` | The app still runs locally with `python -m app` |
| 2 | AI | Gemini by AI Studio key, then Groq, then rules | Vertex AI Gemini by service account, then Groq, then rules | Settings only (`app/ai.py` already supported it) | Groq, then the rule engine |
| 3 | Keys | `.env` file on the server | Secret Manager | `deploy/gcp/deploy.ps1` | `.env` locally |
| 4 | Team records | SQLite file `instance/atlas.db` and hub files on the server's disk | Same files, saved to a Cloud Storage bucket after each change and restored at start | `app/gcp.py` (new), `app/__main__.py`, `app/main.py` | Local disk, as before |
| 5 | Alert checks | A loop inside the server every 30 minutes | Cloud Scheduler calls `POST /tasks/alerts` every 30 minutes, the same check | `app/main.py` | The in-server loop still runs |
| 6 | Live temperature, wet-bulb, today's high | Open-Meteo | Google Weather API | `app/gmaps.py` (new), `app/live.py`, `app/alerts.py` | Open-Meteo |
| 7 | Live PM2.5 | Open-Meteo (CAMS) | Google Air Quality API | `app/gmaps.py`, `app/live.py`, `app/alerts.py` | Open-Meteo |
| 8 | Hub search in Manage hubs | Open-Meteo geocoding | Google Geocoding API | `app/gmaps.py`, `app/main.py` | Open-Meteo geocoding |
| 9 | Impact export | Download CSV and Print or save as PDF | Also Export to Google Sheets and Create brief in Google Docs, saved to the visitor's Drive | `public/gexport.js` (new), `public/app.js`, `public/index.html` | CSV and PDF buttons, unchanged |
| 10 | Earth view · Data centres map | Leaflet with OpenStreetMap tiles | Google Maps JavaScript API with clusters, popups, risk rings and satellite view | `public/app.js` | OpenStreetMap map (also kept as a switch for the density layer) |
| 11 | Cyclone data job | NOAA IBTrACS download (145 MB) | BigQuery public dataset `noaa_hurricanes`, used only if it covers 1980 to 2024 | `jobs/bq.py` (new), `jobs/sources/cyclones.py` | NOAA download |
| 12 | Data centre locations job | OpenStreetMap extract from the japan-data-centers project | BigQuery `geo_openstreetmap` with Overture country borders, used only when the extract is missing | `jobs/sources/facilities.py`, `jobs/check_gcp.py` | Extract stays first |
| 13 | Health check | `/api/health` lists AI and data sources | Adds a `google` block showing which Google services are connected | `app/main.py` | Not applicable |
| 14 | Decision records | SQLite tables for approvals, audit trail, meter summaries and assumptions | Firestore, each change one transaction that also moves the audit trail's head, so the fingerprint chain can't break; records already in SQLite are copied across once | `app/fsdb.py` (new), `app/governance.py`, `firestore.rules` (new) | SQLite, as before (`FIRESTORE` unset) |
| 15 | Public address | The Cloud Run address | Firebase Hosting `PROJECT.web.app` in front of Cloud Run | `firebase.json` (new), `deploy/gcp/deploy.ps1`, `app/main.py` (`ALLOWED_ORIGINS`) | The Cloud Run address still works |
| 16 | Usage analytics | None | Google Analytics 4 through the Firebase project, with a consent bar; events carry short codes only, never typed text or names | `public/analytics.js` (new), `public/app.js`, `public/gexport.js` | Nothing loads without `GA_MEASUREMENT_ID` or consent |

Also added, not swaps: the Earth view **Timelapse** tab (NASA Blue Marble imagery and a Today to 2050 play timeline), dashboard charts, the **Outlook** forecast charts, the new icon with the tagline, and a fix for links going blank on hover.

**What did not change:** the scoring, the rule engine, the 23 strategies, approvals, the audit trail and every API answer. With no Google keys set, the copy returned identical answers to the original for every API we compared side by side.

**Safety for the public demo:** hub and news-feed editing is switched off (`DEMO_LOCK_HUBS=1`, the page says so; sites, approvals and assumptions stay open), the deployed app starts with a clean database (your local records and any old sign-in accounts stay on your PC), and every save waits until it is copied to the bucket before answering.

**What is tested:** every swap passed with simulated Google responses, and every fallback works. `tests/test_strategist.py` runs 62 server checks on SQLite and 65 with `--firestore` (on a stand-in store; Firestore's emulator needs Java). Nothing has run against live Google services yet, because no project is set up. Step 5 below is that check.

## Step 1: Install the Google Cloud CLI and sign in

The CLI (`gcloud`) is how the script talks to Google Cloud. It isn't installed on this PC yet.

1. Open PowerShell and install it:

```powershell
winget install Google.CloudSDK
```

2. Close PowerShell and open a new window, so it finds `gcloud`.
3. Sign in and pick your project. This opens your browser:

```powershell
gcloud init
```

4. Only if you will run the BigQuery data jobs (Step 6), also sign in for them:

```powershell
gcloud auth application-default login
```

5. Install the Firebase CLI (it puts the `web.app` address in front of Cloud Run) and sign in. If `npm` isn't found, install Node.js first with `winget install OpenJS.NodeJS.LTS` and open a new window:

```powershell
npm install -g firebase-tools
firebase login
```

Check it worked: `gcloud --version` and `firebase --version` print versions, and `gcloud config list` shows your account.

## Step 2: Create a project and link billing

Use one project for everything in this guide. Its ID is what you pass to the script.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), open the project picker and choose **New project**. Note the **project ID** (for example `adaptation-strategist-2026`), not the name.
2. Open **Billing** and link the project to a billing account. New accounts can start the $300 free trial here.
3. Open **Billing > Budgets & alerts** and create a budget of ₹500 with email alerts at 50%, 90% and 100%. You hear about any spend long before it matters.
4. Point the CLI at the project:

```powershell
gcloud config set project YOUR_PROJECT_ID
```

5. Add Firebase to the same project: open [console.firebase.google.com](https://console.firebase.google.com), choose **Add project** (or **Create a project**) and pick your existing Google Cloud project from the list. Turn **Google Analytics** on when asked and choose or create an Analytics account. (The script can add Firebase on its own too, but Analytics is only switched on here.)
6. In the Firebase project, open **Project settings > General > Your apps**, add a **Web** app (no hosting setup needed in that dialog) and copy its **Measurement ID** (`G-…`). It goes in `.env` in Step 3.

The script enables every API it needs, so you don't switch any on by hand.

## Step 3: Create the Google keys and fill in .env

Three keys and one ID turn on the Google swaps 6 to 10 and 16. All are optional: without one, that feature uses its original source or stays off.

| Setting in `.env` | Turns on | Where to create it | Restrict it to |
| --- | --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | Weather, Air Quality and Geocoding (swaps 6 to 8) | Console > **APIs & Services > Credentials > Create credentials > API key** | APIs: Weather API, Air Quality API, Geocoding API |
| `GOOGLE_MAPS_BROWSER_KEY` | Google Maps on the Data centres map (swap 10) | Same place, a second API key | API: Maps JavaScript API. Websites: `http://localhost:8080/*` and your Cloud Run URL (add it after Step 4) |
| `GOOGLE_OAUTH_CLIENT_ID` | Export to Sheets and Docs (swap 9) | Console > **Google Auth Platform > Clients > Create client**, type **Web application** | Authorized JavaScript origins: `http://localhost:8080`, your Cloud Run URL and `https://YOUR_PROJECT_ID.web.app` |
| `GA_MEASUREMENT_ID` | Google Analytics (swap 16) | Firebase project settings, Step 2 point 6 | Nothing to restrict: it is public by design |

For the OAuth client, also set up the consent screen first (**Google Auth Platform > Branding** and **Audience**): choose **External**, then under **Audience** press **Publish app** so it is **In production**. The app only asks for `drive.file` (files it creates), which Google treats as non-sensitive, so no review is needed and judges can export with any Google account. In **Testing** only listed test users could export.

Then open `.env` in the project folder and add the values:

```
GOOGLE_MAPS_API_KEY=your-server-key
GOOGLE_MAPS_BROWSER_KEY=your-browser-key
GOOGLE_OAUTH_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GA_MEASUREMENT_ID=G-ABC123XYZ
```

Keep your existing keys (Groq, OpenAQ, Electricity Maps, EIA) as they are; the script copies them to Secret Manager too. `GEMINI_API_KEY` isn't used on Cloud Run, because Gemini runs on Vertex AI there.

## Step 4: Run the deploy script

One command does the whole deployment. It is safe to run again: it reuses what already exists.

```powershell
cd "D:\code\AI Builder Cup\adaptation-atlas-gcp"
powershell -ExecutionPolicy Bypass -File deploy\gcp\deploy.ps1 -Project YOUR_PROJECT_ID
```

What it does, in order:

1. Selects your project and enables 16 APIs: Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Vertex AI, Cloud Storage, Cloud Scheduler, Firestore, Firebase, Firebase Hosting, Weather, Air Quality, Geocoding, Sheets, Docs and Maps.
2. Creates the service account `atlas-run` and lets it use Vertex AI.
3. Creates the bucket `YOUR_PROJECT_ID-atlas`. The deployed app starts with a clean database; your local records stay on your PC.
4. Creates the Firestore database (Native mode, in the same region) and lets the service account use it.
5. Copies the keys that are set in `.env` into Secret Manager, and creates a random `TASK_TOKEN` for Cloud Scheduler.
6. Builds the app from source and deploys it to Cloud Run with Vertex AI and Firestore switched on and hub editing locked: at most one instance and none when idle, 1 GB of memory, startup CPU boost, and CPU kept on while an instance is up so a site's data build and the copy to the bucket finish.
7. Creates the Cloud Scheduler job `atlas-alerts`, which calls `/tasks/alerts` every 30 minutes.
8. Adds Firebase to the project if needed and deploys Firebase Hosting (`https://YOUR_PROJECT_ID.web.app`) and the Firestore rules, which shut out every browser. Without the Firebase CLI this step is skipped with a message.

It ends by printing both addresses, for example `https://YOUR_PROJECT_ID.web.app` (submit this one) and `https://atlas-web-abc123-el.a.run.app`.

Options:

| Option | Default | Use it to |
| --- | --- | --- |
| `-Region` | `asia-south1` (Mumbai) | Deploy elsewhere, for example `asia-southeast1` (Singapore) |
| `-Bucket` | `YOUR_PROJECT_ID-atlas` | Use a bucket name of your choice |
| `-Private` | off (public link) | Require sign-in; see Step 6 |
| `-UnlockHubs` | off (hubs locked) | Allow hub and news-feed edits on the deployed app |

After the first run, add both printed addresses to the browser key's websites and the OAuth client's JavaScript origins (Step 3). No redeploy is needed for that.

## Step 5: Check that it works

This is the first time each Google swap runs against the real services, so check each one. Start with the health page: open `YOUR_APP_URL/api/health` and find the `google` block.

| Field in `google` | Should be | If not |
| --- | --- | --- |
| `cloudRun` | `true` | Not running on Cloud Run |
| `vertexAI` | `true` | Vertex AI setting missing; rerun the script |
| `cloudStorage` | `true` | Bucket setting missing; rerun the script |
| `scheduler` | `true` | `TASK_TOKEN` missing; rerun the script |
| `weather`, `airQuality`, `geocoding` | `true` | `GOOGLE_MAPS_API_KEY` not in `.env` |
| `mapsJavaScript` | `true` | `GOOGLE_MAPS_BROWSER_KEY` not in `.env` |
| `sheetsDocsExport` | `true` | `GOOGLE_OAUTH_CLIENT_ID` not in `.env` |
| `firestore` | `true` | `FIRESTORE` setting missing; rerun the script |
| `firebaseHosting` | `true` when opened through `web.app` | You opened the Cloud Run address, or Hosting wasn't deployed |
| `analytics` | `true` | `GA_MEASUREMENT_ID` not in `.env` |

Open the health page through `https://YOUR_PROJECT_ID.web.app/api/health` so `firebaseHosting` can show `true`. The `demo` block should show `hubsLocked: true`.

Then try each swap in the app:

- [ ] **Firebase address:** open `https://YOUR_PROJECT_ID.web.app`, record an approval in a guided flow (step 5) and press **Verify audit trail**. It should save and verify (swaps 14, 15).
- [ ] **Analytics:** press **Allow analytics** on the bar at the bottom, then open Firebase > Analytics > **DebugView** (or Google Analytics > Realtime). Page views and events such as `select_persona` appear within a minute (swap 16).
- [ ] **Home:** ask a question. The answer names who answered; on Cloud Run it should be Gemini (swap 2).
- [ ] **Earth view · Hazard view:** press **Conditions now**. Temperature and PM2.5 should show Google Weather API and Google Air Quality API as sources (swaps 6, 7).
- [ ] **Earth view · Data centres:** the map should be Google Maps, with a Satellite option (swap 10).
- [ ] **Impact:** press **Export to Google Sheets**, sign in, and open the link it gives (swap 9).
- [ ] **My workspace · Manage hubs:** search a city; results come from Google Geocoding (swap 8).
- [ ] **Records survive a restart:** add a team site and record an approval, then run the command below to start a fresh copy of the app. Both should still be there (swaps 4, 14).

```powershell
gcloud run services update atlas-web --region asia-south1 --update-env-vars RESTART=1
```

- [ ] **Alerts:** run the schedule once by hand. It should report success (swap 5).

```powershell
gcloud scheduler jobs run atlas-alerts --location asia-south1
```

## Step 6: Optional extras

None of these is needed for the demo.

**Private access with sign-in.** The app has no login, so a public link lets anyone change hubs and record approvals. For a team-only app:

1. Deploy with `-Private` added to the Step 4 command.
2. In the console, open **Cloud Run > atlas-web > Security** and turn on **Identity-Aware Proxy**.
3. Grant the people who may use it the **IAP-secured Web App User** role.

For judging, a public link is simpler; keep the private setup for real use.

**BigQuery data jobs (swaps 11 and 12).** These rebuild the data files on your PC; they don't run on Cloud Run.

1. Add `GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID` to `.env`.
2. Sign in for jobs: `gcloud auth application-default login`.
3. Install the job packages: `pip install -r requirements-jobs.txt`.
4. Check access: `python -m jobs.check_gcp`. Each table should show **ok**.
5. Rebuild the cyclone data from BigQuery: `python -m jobs.build_hazards --fresh`.

Each query is dry-run first and skipped above 200 GB (`BQ_MAX_GB`), so it stays inside BigQuery's free 1 TB a month. Earth Engine is free for non-commercial and research use only.

## Updating the app and what it costs

**To update,** change the code and run the Step 4 command again. Approvals and the audit trail live in Firestore, and sites, alerts and hub edits in the bucket, so they survive every redeploy. To change a key, edit `.env` and rerun the script; it adds a new version of that secret.

**Costs** for a demo or hackathon, as published in October 2026. Confirm on [cloud.google.com/free](https://cloud.google.com/free) before relying on them.

| Service | Free each month | Demo cost |
| --- | --- | --- |
| Cloud Run | 2 million requests plus a compute allowance | ₹0. With the CPU kept on, an instance is billed while it is up (it stops after about 15 idle minutes); demo traffic stays inside the free allowance |
| Firestore | 50,000 reads and 20,000 writes a day, 1 GB stored | ₹0 |
| Firebase Hosting | 10 GB stored, 360 MB a day transferred | ₹0 |
| Google Analytics 4 | Free | ₹0 |
| Cloud Storage | 5 GB (US regions; small charges elsewhere) | About ₹0: the records are under 1 MB |
| Secret Manager | A few active secrets | ₹0 to a few rupees |
| Cloud Scheduler | 3 jobs | ₹0 (the app uses 1) |
| Cloud Build | Free daily build minutes | ₹0 |
| Vertex AI Gemini | No free tier | Paid from trial or hackathon credits |
| Weather, Air Quality, Geocoding, Maps JavaScript | A free monthly cap per API | ₹0 at demo traffic |
| Sheets and Docs APIs | Free | ₹0 |
| BigQuery | 1 TB of queries, 10 GB storage | ₹0 |

The app limits each visitor to 40 AI requests every 10 minutes, which protects your credits on a public link.

## Troubleshooting

| What you see | Why | Fix |
| --- | --- | --- |
| `gcloud` is not recognized | PowerShell was open before the install | Close it and open a new window |
| "Firebase CLI not found, so the web.app address was skipped" | `firebase-tools` isn't installed | Step 1 point 5, then rerun the script |
| Firebase deploy says the project has no Firebase | Firebase wasn't added to the project | Step 2 point 5, then rerun the script |
| Saving on the `web.app` address says "Requests from other sites are refused" | The app doesn't know the Firebase address | Rerun the script; it sets `ALLOWED_ORIGINS` to `https://YOUR_PROJECT_ID.web.app` |
| Approvals or the audit trail say "The team records store (Firestore) is not reachable" | The Firestore database or its permission is missing | Rerun the script; it creates the database and grants `roles/datastore.user` |
| Manage hubs says editing is switched off | The public demo locks hub edits on purpose | Deploy with `-UnlockHubs` if you need to edit hubs |
| Billing account not found, or billing must be enabled | The project has no billing account linked | Step 2, point 2 |
| Deploy fails on `--allow-unauthenticated` | Your company account's policy blocks public links | Deploy with `-Private` and use Identity-Aware Proxy (Step 6), or use a personal Google account |
| The app stops at start with "Could not read gs://…" | The service account can't read the bucket | Rerun the script; it grants access again |
| AI answers say they came from the rules or Groq, not Gemini | A model name in `GEMINI_MODEL` isn't available on Vertex AI in your project | Set `GEMINI_MODEL` in `.env` to a model your project lists under Vertex AI, then rerun the script |
| Data centres map shows OpenStreetMap with "Google Maps didn't accept the key" | The browser key lacks the app's address or the Maps JavaScript API | Add `YOUR_APP_URL/*` to the key's websites and allow the Maps JavaScript API |
| Export says it isn't set up | `GOOGLE_OAUTH_CLIENT_ID` missing on the server | Add it to `.env` and rerun the script |
| Google sign-in pop-up closes with an error | The app's address isn't an authorized origin, or the app is still in Testing | Add the address and publish the app to Production (Step 3) |
| Scheduler run shows 403 | The task token in the job doesn't match the app | Rerun the script; it updates both |
| Live readings fail with CERTIFICATE_VERIFY_FAILED when running on this PC | This PC's network inspects secure traffic | Only affects local runs; Cloud Run is not affected |

To see the app's own error messages, open **Cloud Run > atlas-web > Logs** in the console, or run `gcloud beta run services logs read atlas-web --region asia-south1`.
