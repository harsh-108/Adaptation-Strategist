# Adaptation Strategist (built on the Adaptation Atlas)

A climate-adaptation planner for data centre growth, for four personas: **data centre operator**, **colocation & hyperscaler**, **enterprise tenant** and **policy maker**. Every place is scored only from measured open data (see [Data sources](#data-sources)): heat, flood, water stress, grid reliability, cyclones, volcanoes, earthquakes and wildfire under today, 2030 and 2050 scenarios (overall risk = 60% the average of the hazards with data + 40% the worst one).

## For judges

**Try it:** `https://adaptation-strategist-2026.web.app` (Firebase Hosting) or the same app at its Cloud Run address, `https://atlas-web-….run.app`. There is **no login and no test account**: pick a persona at the top right. Hub editing is switched off on the public demo so the shared data stays intact; everything else (sites, approvals, assumptions, exports) works.

**How Google Cloud is used**

| Service | What it does here |
| --- | --- |
| **Cloud Run** | Runs the whole app (pages and API) as one Python/FastAPI service in Mumbai. Scales to zero when idle, at most one instance, startup CPU boost. |
| **Firebase Hosting** | The public `web.app` address, passing every request to Cloud Run. |
| **Firestore** | The team's decision records: approval requests, the hash-chained audit trail, meter summaries and assumptions. Each change is one transaction that also moves the audit trail's head, so the fingerprint chain can't break. Only the server's service account can reach it; the security rules refuse every browser. |
| **Gemini on Vertex AI** | Powers the **Ask Gemini** chat window (the ✦ button on every screen). Planning requests ("where should we build…", "compare…") are turned into settings through a JSON schema whose values are limited to the app's own lists, with buttons that open the right screen. Questions about a place are answered from that place's measured scores and evidence, with follow-ups kept per place. One model call per message. |
| **Google Analytics 4** (Firebase project) | Counts which screens and features are used, only after the visitor presses **Allow analytics**. Events carry short codes (persona, step, format), never typed text or names. |
| Secret Manager, Cloud Storage, Cloud Scheduler | Keys (never in code), the saved sites/alerts file and hub files, and the 30-minute alert check. |
| Maps Platform, Sheets and Docs APIs, BigQuery | Live weather, air quality and place search; export of the impact report to the visitor's own Drive; public datasets in the offline data jobs. |

**Sample questions and walkthroughs**

1. **✦ Ask Gemini** (the chat button at the bottom right of every screen), as Data centre operator: "We run a campus in Chennai. What should we fix first for 2050?" The answer stays in your persona, shows who answered (Gemini, Groq or the rule engine) and offers to open the guided flow on Chennai. Then ask "Why is Tokyo's earthquake risk so high?" for an answer grounded in Tokyo's data, and a follow-up such as "What should we do about it?".
2. **✦ Ask Gemini** (as Colocation & hyperscaler): "Where in Southeast Asia should we build our next 100 MW block?" The place becomes the lowest-risk of the seven Southeast Asian matches (Singapore at the time of writing).
3. **✦ Ask Gemini** (as Policy maker): "What would 50 MW a year of data centres mean for Malaysia's grid and water?"
4. **My workspace → Guided flow → ▶ Watch a sample run** (any persona): the six steps play through to the approval step with the persona's first worked example.
5. **Policy maker → My workspace → Growth what-if**: set Jakarta, 50 MW a year, 20 years. The Dashboard now shows Indonesia: every screen shares the same inputs.
6. **Earth view → Data centres**: 1,507 real facilities (OpenStreetMap and PeeringDB) with the climate risk of our 27 places; click a dot, then **Add to team sites**.
7. **Guided flow step 5 → send for approval**, approve it as the next approver, then **Verify audit trail**.

**Data and guardrails**

- **Numbers never come from the AI.** Every score is computed in code from measured open data (NASA POWER, World Bank CMIP6, WRI Aqueduct, NOAA IBTrACS, STORM, USGS, Smithsonian GVP, NASA FIRMS, Ember, Grid-India, utility reports, OpenStreetMap, PeeringDB; full list in [Data sources](#data-sources); in the app, **Glossary › Data sources** lists all 47 sources and services in five groups, built in, live, reference, AI and cloud, synthetic, with what is connected right now). Each number is labelled **Measured**, **Your data**, **Estimate**, **Assumption** or **No data**; a missing value is shown as No data, never borrowed from another place or estimated.
- **The AI is boxed in.** Gemini returns JSON that must match a schema with fixed value lists (place IDs come from the 27 places in scope); anything else is dropped. The user's text is treated only as a request, never as instructions. If Gemini is slow, overloaded or unavailable, Groq answers, then a deterministic rule engine, and the answer says which one replied.
- **Limits and safety.** 40 AI requests per visitor every 10 minutes; changes are refused from other websites; secrets live in Secret Manager; the browser Maps key and the Analytics ID are public by design and the Maps key is restricted to the app's addresses.
- **Privacy.** Meter files are read in the browser and only a one-line summary is stored; pooled figures hide any group with fewer than 5 operators; analytics only with consent. Details: `/privacy.html` in the app.

**Known limitations**

- Asia-Pacific (JAPAC) only: 27 places. OpenStreetMap and PeeringDB don't list every data centre (the Data centres tab shows coverage against published totals), and no open source gives facilities' MW.
- Flood, grid reliability, volcanoes, earthquakes and wildfire have no 2030/2050 projection, so they show today's value (labelled "today only").
- Sample meter files are **synthetic and labelled Sample**; lever effects with no open source start blank (Assumptions), so those levers do nothing until someone enters a value with its source.
- Sites and alerts are kept in one SQLite file saved to Cloud Storage, so the service runs at most one instance.
- The first visit after an idle spell starts a fresh instance (cold start), which takes a few seconds.

**Scope: JAPAC.** Every screen shows only the 27 Asia-Pacific places, matching the JAPAC rulebook (17 rules with sources plus 3 internal PUE targets; Indonesia, New Zealand, the Philippines, Taiwan, Thailand and Vietnam have no rule on file yet). Hubs elsewhere stay in the data files but are hidden; `SCOPE` at the top of `public/app.js` sets this. New sites and hubs outside Asia-Pacific can't be added. The map's Colour by leaves out volcanoes, earthquakes and wildfire (they still count in every score), lists only hazards that vary across the places shown, and marks flood and grid reliability, which have no 2030/2050 projection, as "today only".

**No login.** There are no accounts. A persona picker in the header sets which sections you see, and the whole team shares one workspace on the server: sites, approval requests, the audit trail, meter summaries and assumptions. Keep the server on an internal network or VPN: anyone who can open it can change hubs (decision 1, see `docs/strategist-merge-plan.md`).

Screens (menu: Home · My workspace · Dashboard · Earth view · Impact · Glossary). Work starts in **My workspace**: explore (My sites, Expansion finder, Growth what-if…), press **Plan this** on a site or place, then finish in the workspace's last tab, the **Guided flow**. Each persona has **one set of inputs** (the guided flow's): Growth what-if, the guided flow, the Dashboard and Impact all read and change the same place, size and horizon, shown in a **Working on** bar on My workspace and the Dashboard.

- **Ask Gemini** (✦ button at the bottom right of every screen): a chat window. Planning requests open the right persona's guided flow, place detail or comparison with the inputs filled in; questions about a place are answered from its measured data (Gemini, then Groq, then the rule engine; each answer says which).
- **Home**: the four stat tiles (the sources tile opens the full source register), persona cards and the AI system register.
- **Guided flow** (the last My workspace tab; six steps: persona → inputs → baseline → adjust → best fit → approval), one per persona:
  - *Operator*: retrofit plan for a site (PUE from an uploaded meter file, resilience = 100 − overall risk, water stress, capex);
  - *Colocation & hyperscaler*: where to build the next block (grid carbon, water risk, climate risk, latency, capex index);
  - *Enterprise tenant*: where to run an AI workload (carbon per 1,000 inferences on Google Cloud's 2025 region data, host heat and climate risk, latency, cost index);
  - *Policy maker*: a growth policy package (emissions, water drawn in stressed basins, climate risk at growth sites, electricity).

  Levers are classed no-regret, trade-off or maladaptation; "AI best fit" tries every combination of the 12 strongest levers (the design's levers plus the strategy library's 23 strategies). Every number is badged **Measured**, **Your data**, **Estimate**, **Assumption** or **No data**.
- **Approval (step 5)**: the design's approval hierarchy (e.g. capex above $5M → facility lead then capex committee; 200 MW+ → investment committee then board; Korea → AI compliance lead; policy → director then minister). People type their name; each decision needs a reason and lands in a hash-chained audit trail kept on the server ("Verify audit trail" re-checks it). Each persona's Dashboard lists requests waiting for a decision.
- **Dashboard**: the persona's own view (site cockpit, fleet risk & siting, workload placement, regional observatory) with the AI recommendation and the approvals waiting.
- **My workspace**: *data centre operator, colocation & hyperscaler, enterprise tenant*: My sites (shared team list, each scored at its own coordinates), Expansion finder, Backup pairing, Manage hubs (add, edit, remove hubs and news feeds); *policy maker*: Growth what-if, Impact ranking. *Everyone*: Alerts, **Assumptions** and the **Guided flow**. Plan this buttons: My sites and Place detail (operator, colocation), Expansion finder (colocation), Impact ranking and Place detail (policy maker); sample sites can be planned too.
- **Assumptions** (decision 4): lever effects and costs with no open source (PUE savings, capex, PPA cuts, smaller-model savings, cost bands for the library strategies) start **blank** and count as zero until someone enters a value with their name and where it comes from. Every change is logged.
- **Meter files** (decision 2): an operator's hourly meter file is read in the browser. Only a one-line summary (country, size group, PUE, WUE, completeness) is kept on the server, for the policy maker's pooled figures, which hide any country and size group with fewer than 5 operators.
- **Earth view**, five tabs: *Hazard view* (petals for every place, before and after your plan; live conditions and recent events from GDACS, NASA EONET and admin RSS feeds), *Data centres* (the real facilities, see Data sources), *Map & ranking* (colour by a hazard), *Place detail* (with the data centres within 50 km) and *Compare* (up to six places). These replace the old More menu (review of 17 Oct 2026; old `#/more/...` and `#/guided` links redirect).
- **Impact**: before vs after of the chosen plan, with CSV export and print / save as PDF.
- **Glossary**: terms, rules in force (JAPAC rulebook with sources), the strategy library and the data sources used by places in scope.
- **Alerts** (My workspace, every persona; in the app only, nothing is emailed): the team follows hubs (also from Earth view · Place detail) and its own sites automatically, and gets an alert when a place's risk band changes after a data update, or when a live reading (today's forecast high, wet-bulb, PM2.5, river flow vs its 30-day median; Open-Meteo) passes a limit. The server checks every `ALERT_MINUTES`; "Check now" runs it at once. Unread alerts show as a count on My workspace.

**Reliability:** every AI feature tries **Gemini** first (moving through a list of Gemini models), then an optional **Groq** backup, then a deterministic **rule-based** fallback (`app/rules.py`), and says which one answered. Recent events come from open feeds and work without any AI.

Stack: static pages (`public/`) served by a **Python/FastAPI** app (`app/`), calling **Gemini** via the Google Gen AI SDK. Data jobs are Python too (`jobs/`).

```
app/            FastAPI server: API, AI calls, rule engine, live readings, hubs, sites, team.py (shared workspace), governance.py (approvals, audit trail, meter summaries, assumptions)
instance/       atlas.db: the team's sites, alerts, requests, audit trail, meter summaries and assumptions (created on first run; never committed or deployed over)
jobs/           data jobs: build_hazards (open data), add_hub, site_hazards, check_gcp, sources/
public/         index.html + app.js/app.css/base.css (the app), samples.js (Google region carbon; fictional sample meter files), data.js and hazards.json/.js (hubs and scores)
scripts/        hub-meta.json (hub details), coverage.md (what has data), derived/ (condensed big sources), .cache/ (downloads, not deployed)
deploy/         systemd unit and nginx site for a Linux server
docs/           strategist-merge-plan.md: what changed from the atlas and the five decisions
```

## Run locally

Python 3.10 or newer for the app (`requirements.txt`, all a server needs). Rebuilding the big data sources on your PC also needs `requirements-jobs.txt` (Python 3.11+).

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt        # Linux/macOS: .venv/bin/pip
copy .env.example .env                                 # then put your keys in .env (Linux/macOS: cp)
.venv\Scripts\python -m app
```

Open http://localhost:8080 (change it with `PORT` in `.env`). The app reads `.env` on startup; any variable already set in your shell wins over the file. `.env` is in `.gitignore` and `.gcloudignore`, so it is never committed or deployed. With no keys at all the atlas still runs on the rule-based fallback; set `MOCK_AI=1` for sample AI output. Get a Gemini key at https://aistudio.google.com/apikey and a Groq backup key at https://console.groq.com/keys.

If the port is taken, the app stops with an error saying so.

Server checks (throwaway database, nothing sent anywhere): `python tests/test_strategist.py` (records in SQLite) and `python tests/test_strategist.py --firestore` (records in Firestore, on a stand-in store).

**No accounts to set up.** Open the address and pick a persona at the top right. Upgrading from the signed-in atlas: on first start the server moves every existing site, watch and alert into the shared team workspace; the old account records stay in `instance/atlas.db` untouched but are no longer used. A copy of the previous code is in `../adaptation-atlas_backup_2026-10-16/`.

## Data sources

`public/hazards.json` (and `hazards.js`, the same data for the browser) is built by a job you run occasionally, not on every visit:

```bash
.venv\Scripts\python -m jobs.build_hazards                 # all hubs; raw responses cached in scripts/.cache
.venv\Scripts\python -m jobs.build_hazards --fresh         # refetch everything
.venv\Scripts\python -m jobs.build_hazards --only=MAA,DEL  # print a few hubs, write nothing
```

Some sources are big, so they are downloaded once on the machine that builds the data and condensed into small files in `scripts/derived/` (about 22 MB, deployed with the app so the server can score new sites without the raw downloads):

```bash
.venv\Scripts\python -m jobs.sources.wildfire              # NASA FIRMS fires 2015-2024 for every hub country (~1.4 GB streamed, nothing raw kept)
.venv\Scripts\python -m jobs.sources.wildfire --add BGD    # one more country, e.g. for a site outside the hub countries
.venv\Scripts\python -m jobs.sources.storm                 # STORM future cyclone maps (~169 MB download)
.venv\Scripts\python -m jobs.sources.sealevel              # IPCC AR6 sea level, 2 files pulled out of a 9 GB archive (~146 MB)
.venv\Scripts\python -m jobs.sources.gridindia             # Grid-India daily supply reports 2022-25 for Indian states (~270 MB streamed)
```

**Real data centres** (`public/facilities.json`, 1,507 facilities in the 14 Asia-Pacific countries and territories in scope) come from two open sources, merged by `jobs/sources/facilities.py`: the OpenStreetMap data-centre extract from the japan-data-centers project (copy its `data/data_centers.csv` and `data/reported_totals.csv` into `scripts/.cache/osm-dc/`) and PeeringDB's keyless facility API. A PeeringDB facility within 250 m of an OpenStreetMap object with the same operator (80 m for any) counts as the same building. Rerun to refresh:

```bash
.venv\Scripts\python -m jobs.sources.facilities            # cached PeeringDB answers
.venv\Scripts\python -m jobs.sources.facilities --fresh    # ask PeeringDB again
```

They drive Earth view · Data centres (Leaflet map with OpenStreetMap tiles, clustered dots coloured by type and sized by building footprint, a density layer, popups with source links and "Add to team sites", plus coverage against each country's published total, largest operators, types by country and data centres near our places), the "data centres within 50 km" counts and the list in Place detail. No open source gives MW, so none is shown.

Example sites for My sites are real data centres picked from that file (`scripts/sample-sites.json`: CtrlS Chennai, NTT Mumbai 7, STT Delhi 2; CtrlS Hyderabad, Equinix JH1 Johor, Google Inzai; Amazon SIN5, Google Lok Yang 1, AWS Sydney), labelled Example and not counted as the team's; rebuild their data with `python -m jobs.site_hazards --samples`. A user's own site is built the same way, in the background, when they save it (about 20 to 60 seconds).

It also writes `scripts/coverage.md`, listing which hazards have data for each hub. Scoring thresholds are in `CONFIG` at the top of `jobs/build_hazards.py` (and each source module) and are shown in the app. The first run downloads the IBTrACS storm archive (145 MB) into `scripts/.cache`.

| Hazard | Source | Method |
|---|---|---|
| Heat | NASA POWER daily temperatures 1991-2020 at the hub; World Bank CCKP CMIP6 ensemble-median warming by country | Half hot days (≥35 °C, 150 a year = 100), half cooling degree days (base 18 °C, 4,000 = 100). Future: add the country warming for SSP2-4.5 / SSP5-8.5, 2020-2039 (2030) and 2040-2059 (2050). |
| Water | WRI Aqueduct 3.0 baseline water stress; Aqueduct 2.1 projections | Aqueduct score 0-5 × 20, area-weighted over sub-basins within 25 km. Future applies Aqueduct 2.1's projected change (SSP2 RCP4.5 moderate, SSP2 RCP8.5 high; 2050 uses 2040). |
| Flood | WRI Aqueduct 3.0 riverine and coastal flood risk | Today = worse of the two × 20. **No open projection yet**: 2030 and 2050 show today's value, labelled "today only". |
| Grid reliability | World Bank Doing Business: SAIDI and SAIFI measured by the utility, 2019 (keyless API) | Average of hours without power (0.1 h = 0, 100 h = 100) and interruptions (0.1 = 0, 30 = 100) a year, log scales. **Only for the city the World Bank measured** (each economy's main business city; two cities for the 11 largest, e.g. Delhi and Mumbai). Elsewhere in India: **Grid-India daily Power Supply Position reports** (state-level): the share of the state's electricity demand that went unsupplied (0.001% = 0, 1% = 100, log scale) averaged with the share of days the state was short at its daily peak (50% of days = 100), from every daily Excel report since January 2023 (April-December 2022 exist only as PDFs). For hubs the World Bank didn't measure, the **utility that serves the place**: US EIA Form 861 reliability files (Dominion, APS, Oncor, PG&E, Grant County PUD, Georgia Power, ComEd, AEP Ohio; all events including major event days, 2020-2024 average; `jobs/sources/utilrel.py`, `scripts/derived/utility_reliability.json`) Hydro-Québec Distribution's gross continuity index for Montreal (its annual reports to the Régie de l'énergie, 2020-2024; duration only), and Taipower's published figures for Taipei. These cover the utility's whole service area. Other hubs show **No data** with the reason: the national figure is another city's, and the atlas never borrows it. An admin-entered value wins. |
| Cyclones | NOAA IBTrACS tracks, 1980-2024; STORM present and future (2015-2050, SSP5-8.5, median of 4 models) wind return periods | Half tropical storms passing within 150 km per decade (10 = 100), half typhoon/hurricane-strength passes within 100 km per decade (3 = 100). For high emissions, 2030 and 2050 multiply those rates by STORM's future-to-present change in how often 20 m/s and 29 m/s (about Category 1) winds occur at the place. STORM has no moderate run, so the moderate pathway keeps the history. Before: history only for now. |
| Volcanoes | Smithsonian Global Volcanism Program | Closest, most recently active Holocene volcano within 100 km. Doesn't change over time. |
| Earthquakes | USGS catalogue, 1950-2024 | Magnitude 6+ quakes within 300 km per decade (8 = 100). Doesn't change over time. |
| Wildfire | NASA FIRMS MODIS active fires, 2015-2024 (keyless country files) | Vegetation fires (type 0, confidence ≥ 30) detected within 25 km a year; score = 100 × √(fires a year ÷ 150). Includes crop burning. History; no projection. |
| Sea level (context, not scored) | IPCC AR6 regional projections at tide gauges (Zenodo) | Rise by 2030 and 2050 with the likely range, at the nearest tide gauge within 30 km; shown on hub pages, site cards, reports and to the AI. Not scored, because without the site's elevation and defences rise alone isn't a risk score. 20 hubs have a gauge nearby. |
| Extras | OpenStreetMap + PeeringDB (`facilities.json`), NASA POWER solar | Data centres within 50 km, solar resource. |
| Grid carbon and electricity demand | Ember data via Our World in Data (keyless CSV) | National grid carbon intensity (g CO₂/kWh, latest year and ten years earlier) and total electricity demand (TWh), used for the carbon panel and the impact view. |

**Measured data only.** Every score is labelled **Data**, **Data · today only**, **Your value** (entered by an admin) or **No data**, with its basis on hover. A hazard with no data is left out of the overall score and never filled in from other hubs or estimated; the hub page says which hazards the overall score uses. The AI is given the same evidence and told never to guess a missing value.

**Warming stripes** under the header follow the place the persona is working on: NASA POWER yearly mean temperature 1991-2020 (`GET /api/stripes?lat=&lon=`, fetched once per place and cached in `instance/stripes/`).

**Live readings** (`GET /api/live/{hub}`, cached an hour per hub, 5 minutes after a failure): Open-Meteo forecast, flood (GloFAS) and air quality (no key); OpenAQ (`OPENAQ_API_KEY`); Electricity Maps (`ELECTRICITYMAPS_API_KEY`), or the GB Carbon Intensity API for London (no key); EIA grid demand for US hubs (`EIA_API_KEY`, otherwise the rate-limited `DEMO_KEY`). A missing key shows "Not configured".

**Licences and attribution:** Open-Meteo's free API is for non-commercial use only (commercial use needs their paid plan). Aqueduct, World Bank CCKP and Ember are CC BY 4.0. STORM (Bloemendaal et al.), IPCC AR6 sea level (Garner et al.) and World Bank data are CC BY 4.0. OpenStreetMap data is ODbL ("© OpenStreetMap contributors"); the map tiles are OpenStreetMap's own (and OSM France's Humanitarian style), used under their tile policies. Credit NASA LaRC POWER, NASA FIRMS, PeeringDB, NOAA IBTrACS (Knapp et al. 2010), the Smithsonian Global Volcanism Program and USGS. All are listed under "Data sources" in the app.

### Still to come

- **CEA**: CEA's own power supply position reports now sit behind a login and captcha, so the atlas uses Grid-India's daily reports (the same measurements, published openly) instead.
- **Earth Engine and BigQuery**: waiting for the Google Cloud project (below).

### BigQuery public datasets in the data jobs

With `GOOGLE_CLOUD_PROJECT` set (and `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default login`), two jobs read BigQuery first and keep their downloads as fallback (`jobs/bq.py`):

- **Cyclones** (`jobs/sources/cyclones.py`, on `--fresh` or when `scripts/derived/ibtracs.npz` is missing): IBTrACS tracks from `bigquery-public-data.noaa_hurricanes.hurricanes`, used only if that copy covers every season scored (1980–2024); otherwise the NOAA download. Same filters and track order, so the storms are identical.
- **Data centres** (`jobs/sources/facilities.py`): the japan-data-centers extract stays first, because it adds a facility kind OpenStreetMap doesn't have. If the extract is missing, OpenStreetMap is read from `bigquery-public-data.geo_openstreetmap.planet_features` with countries from `bigquery-public-data.overture_maps.division_area`, instead of stopping.

Each query is dry-run first and skipped above `BQ_MAX_GB` (default 200). `python -m jobs.check_gcp` confirms the tables can be read.

### Earth Engine and BigQuery (next data jobs)

The next data sources (NEX-GDDP-CMIP6, ERA5-Land, Aqueduct 4.0, JRC surface water, Global Flood Database, GRACE, power plants, GHSL, Dynamic World, MODIS burned area) run through Google Earth Engine and BigQuery. Once your Google Cloud project is set up, add to `.env`:

```
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=C:\keys\atlas-service-account.json
```

then check access (it signs in and confirms each dataset can be read; nothing is written):

```bash
.venv\Scripts\python -m jobs.check_gcp
```

Keep the key file outside the project folder so it is never packaged or deployed. Earth Engine is free only for non-commercial and research use; internal company use normally needs a commercial licence.

## Adding hubs

**In the app:** open **Manage hubs**. Search for a city ("Kochi, India" narrows to a country; Open-Meteo geocoding fills in the coordinates, the World Bank API the country code and region, and Electricity Maps the grid zones), check the details, and save. Saving writes the hub files and fetches its open data (about 10 to 60 seconds); Edit and Remove are in the list. Leaving the page reloads the atlas with the changes.

Saving changes the server's own files. With no login anyone who can open the app can do it (the page is hidden from the policy maker persona only), so keep the server internal. On Cloud Run changes are lost at the next deploy.

**From the command line:**

```bash
.venv\Scripts\python -m jobs.add_hub --id HYD --name Hyderabad --country India --region Asia-Pacific --lat 17.39 --lon 78.49 --iso3 IND --iso2 IN --zone IN-SO --areas "South India" --aliases cyberabad
.venv\Scripts\python -m jobs.add_hub --file scripts/new-hubs.json      # several at once
.venv\Scripts\python -m jobs.add_hub --remove HYD
.venv\Scripts\python -m jobs.build_hazards                              # then fetch the data and restart the server
```

The dot is placed from latitude and longitude (Natural Earth projection); a hub that would sit on top of another is refused (`--force` overrides). `--region` is one of Americas, Europe, Africa & Middle East, Asia-Pacific. `--zone` is the Electricity Maps zone and `--eia` the US balancing authority. `--areas` names parts of a country ("South India") so questions like "where should I build in South India?" find the hub; `--aliases` adds other names. Grid reliability and the change in flood risk have no open source: pass `--grid "today,change"` and `--flood-change N` only if you have measured values; otherwise they show as No data.

## Deploy to AWS EC2 (systemd, optional nginx)

An EC2 disk keeps its files, so Manage hubs works there. Ready-made config is in `deploy/` (app on port 6004).

**1. Package on your PC (PowerShell)** and copy it up with your `.env`, which holds the keys and stays out of the package:

```powershell
tar -czf $env:TEMP\atlas.tgz --exclude=.venv --exclude=__pycache__ --exclude=.env --exclude=.cache --exclude=instance -C F:\Claude adaptation-atlas
scp -i C:\path\to\key.pem $env:TEMP\atlas.tgz F:\Claude\adaptation-atlas\.env ubuntu@SERVER:/tmp/
```

**2. Install on the server (Ubuntu):**

```bash
sudo apt update && sudo apt install -y python3-venv
sudo useradd --system --no-create-home --shell /usr/sbin/nologin atlas
sudo tar -xzf /tmp/atlas.tgz -C /opt && sudo mv /tmp/.env /opt/adaptation-atlas/.env
cd /opt/adaptation-atlas && sudo python3 -m venv .venv && sudo .venv/bin/pip install -r requirements.txt
sudo chown -R atlas:atlas /opt/adaptation-atlas && sudo chmod 600 .env
sudo cp deploy/adaptation-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now adaptation-atlas
curl -s http://127.0.0.1:6004/api/health                            # should print JSON
```

**3a. Without nginx** (open `http://SERVER:6004`, e.g. inside a private network): set `Environment=PORT=6004 HOST=0.0.0.0 TRUST_PROXY=0` in `/etc/systemd/system/adaptation-atlas.service`, run `sudo systemctl daemon-reload && sudo systemctl restart adaptation-atlas`, and allow TCP 6004 from your network in the security group.

**3b. With nginx and HTTPS** (port 80 must be free):

```bash
sudo cp deploy/nginx-adaptation-atlas.conf /etc/nginx/sites-available/adaptation-atlas
sudo sed -i 's/atlas.example.com/YOUR_DOMAIN/' /etc/nginx/sites-available/adaptation-atlas
sudo ln -sf /etc/nginx/sites-available/adaptation-atlas /etc/nginx/sites-enabled/adaptation-atlas
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d YOUR_DOMAIN
```

Logs: `journalctl -u adaptation-atlas -f`. Restart after changing `.env`: `sudo systemctl restart adaptation-atlas`.

**Updating the code later.** Hubs edited on the server live in `public/data.js`, `public/hazards.json`, `public/hazards.js` and `scripts/hub-meta.json`, and the team's records in `instance/`; leave them out of code updates:

```powershell
tar -czf $env:TEMP\atlas-code.tgz --exclude=.venv --exclude=__pycache__ --exclude=.env --exclude=.cache --exclude=instance --exclude=data.js --exclude=hazards.json --exclude=hazards.js --exclude=hub-meta.json -C F:\Claude adaptation-atlas
```

```bash
sudo tar -xzf /tmp/atlas-code.tgz -C /opt && cd /opt/adaptation-atlas && sudo .venv/bin/pip install -r requirements.txt
sudo chown -R atlas:atlas /opt/adaptation-atlas && sudo systemctl restart adaptation-atlas
```

Back up those four data files now and then: `sudo tar -czf ~/atlas-data-$(date +%F).tgz -C /opt/adaptation-atlas public/data.js public/hazards.json public/hazards.js scripts/hub-meta.json instance/atlas.db`.

## Deploy to Google Cloud (one script)

This copy runs on Google Cloud with no change to how the app works. Everything Google-specific is off unless its setting is present, so it still runs the same locally.

| Piece | Google service | Setting |
|---|---|---|
| Web app and API | Cloud Run (builds from source with the `Procfile`) | — |
| Gemini | Vertex AI, signed in by the service account (no API key) | `GOOGLE_GENAI_USE_VERTEXAI=true` |
| Keys from `.env` | Secret Manager | set by the script |
| Public address | Firebase Hosting `PROJECT.web.app`, every request passed to Cloud Run (`firebase.json`) | `ALLOWED_ORIGINS` (set by the script) |
| Approvals, audit trail, meter summaries, assumptions | Firestore (`app/fsdb.py`, `app/governance.py`; rules in `firestore.rules` refuse every browser). Records already in SQLite are copied across once | `FIRESTORE=on` |
| Sites, alerts (`instance/atlas.db`) and hub edits | Cloud Storage: restored at start, copied back before each save is answered, after scheduled tasks and at shutdown (`app/gcp.py`) | `GCS_BUCKET` |
| Usage analytics | Google Analytics 4 through the Firebase project, after the visitor allows it (`public/analytics.js`) | `GA_MEASUREMENT_ID` |
| Public demo protection | Hub and news-feed edits refused; the page says so | `DEMO_LOCK_HUBS=1` (set by the script; `-UnlockHubs` turns it off) |
| Alert checks | Cloud Scheduler calls `POST /tasks/alerts` every 30 minutes, the same check the in-app loop runs | `TASK_TOKEN` |
| Live temperature, wet-bulb, today's high | Google Weather API, falling back to Open-Meteo (`app/gmaps.py`) | `GOOGLE_MAPS_API_KEY` |
| Live PM2.5 | Google Air Quality API, falling back to Open-Meteo (CAMS) | `GOOGLE_MAPS_API_KEY` |
| Hub search in Manage hubs | Google Geocoding API, falling back to Open-Meteo geocoding | `GOOGLE_MAPS_API_KEY` |
| Earth view · Data centres map | Maps JavaScript API with marker clustering: same dots, popups and climate-risk rings, plus satellite and terrain. A switch keeps the OpenStreetMap map (with the density layer, since Google retired its heat-map layer); Leaflet is also used with no key or if Google refuses the key. | `GOOGLE_MAPS_BROWSER_KEY` (restrict it to your site) |
| Impact: Export to Google Sheets, Create brief in Google Docs | Sheets API and Docs API, called in the browser with the visitor's Google account (`drive.file` scope, files go to their Drive; `public/gexport.js`). Download CSV and Print stay as they were. | `GOOGLE_OAUTH_CLIENT_ID` |

```powershell
gcloud auth login
powershell -ExecutionPolicy Bypass -File deploy\gcp\deploy.ps1 -Project YOUR_PROJECT_ID
```

Options: `-Region` (default `asia-south1`), `-Bucket` (default `PROJECT-atlas`), `-Private` (no public link; then turn on Identity-Aware Proxy for the service in the Cloud Run console), `-UnlockHubs` (allow hub edits). The deployed app starts with a clean database; your local records stay on your PC. The Firebase CLI (`npm install -g firebase-tools`, `firebase login`) adds the `web.app` address; without it that step is skipped. Step-by-step: `docs/DEPLOYMENT-GUIDE.md`. Cloud Run is limited to one instance because the records are one SQLite file. `/api/health` shows a `google` block with what is connected.

## Deploy to Cloud Run (manual)

Cloud Run builds the app from `requirements.txt` and starts it with the `Procfile` (`python -m app`, which reads Cloud Run's `PORT`).

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
gcloud secrets create gemini-api-key --data-file=key.txt && rm key.txt     # key saved to a file first, then deleted
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding gemini-api-key --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud run deploy adaptation-atlas --source . --region asia-southeast1 --allow-unauthenticated --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

Add other keys (Groq, OpenAQ, Electricity Maps, EIA, Ember) to `--set-secrets` the same way. Cloud Run's disk is temporary, so sites, approvals, the audit trail and assumptions made there are lost at each deploy or restart; EC2 (or any server with a disk) is the intended home. For Vertex AI instead of a key: `--set-env-vars GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=global` and grant the service account `roles/aiplatform.user`.

## Settings

| Variable | Purpose | Default |
|---|---|---|
| `GEMINI_MODEL` | Model id, or a comma-separated fallback list | `gemini-flash-latest,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest` |
| `GEMINI_API_KEY` | AI Studio key | none |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` to use Vertex AI | off |
| `GROQ_API_KEY` / `GROQ_MODEL` | Groq backup provider | none / `openai/gpt-oss-120b,openai/gpt-oss-20b` |
| `AI_TIMEOUT_MS` | Time to wait for each AI call before moving on | `20000` |
| `MOCK_AI` | `1` for sample output without calling an AI | off |
| `PORT` / `HOST` | Where the app listens; `HOST=127.0.0.1` behind nginx | `8080` / all addresses |
| `TRUST_PROXY` | Proxy hops to trust for the visitor's address; `0` with nothing in front | `1` |
| `ALERT_MINUTES` | How often the server checks the team's live alert limits | `30` |
| `RELIEFWEB_APPNAME` | Adds UN OCHA ReliefWeb reports to Recent events and news (ReliefWeb approves app names: apidoc.reliefweb.int) | off |
| `ATLAS_INSTANCE_DIR` | Where the team's records are stored, e.g. a throwaway copy for testing | `instance/` |
| `OPENAQ_API_KEY`, `ELECTRICITYMAPS_API_KEY`, `EIA_API_KEY`, `EMBER_API_KEY` | Live readings and grid carbon | none |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` | Earth Engine and BigQuery data jobs | none |

`/api/health` reports what is connected. Each instance allows 40 AI requests per visitor per 10 minutes, to protect your quota on a public link.

## Data note

These are screening values: country-average warming, basin-level water and flood risk and a 0.5° temperature grid all smooth out local conditions, grid reliability is measured only in the cities the World Bank covered (2019), and wildfire counts satellite fire detections (including crop burning), not damage. Gemini explains and sequences the engine's results; it never produces the scores. Validate with site-level data before any investment decision.
