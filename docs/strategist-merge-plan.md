# Plan: Adaptation Strategist becomes the main app

Status: **built 16 Oct 2026** and running at `http://localhost:8095/`. The previous code is in `../adaptation-atlas_backup_2026-10-16/`. Differences from this plan: `app/auth.py` stays (it holds the database connection; its sign-in functions are unused), and the printable reports were not rebuilt (Impact has CSV and print). Alerts came back as a My workspace tab for every persona on 16 Oct 2026.

## 1. What you asked for

| Ask | Where it lands |
|---|---|
| Adaptation Strategist is the main app, working the way it works in the design | New front end built on the Strategist's screens and flows: Workspaces home, 6-step Guided flow, persona dashboards, Impact, Earth view |
| My workspace for everyone except Policy: My sites, Expansion finder, Backup pairing, **Manage hubs** | "My workspace" tabs for Data centre operator, Colocation & hyperscale, Enterprise tenant |
| Growth what-if and Impact ranking for Policy | "My workspace" tabs for Policymaker only |
| Gemini Ask merged into the home screen | Ask box on the Workspaces home; the answer opens the right persona's Guided flow with inputs filled in |
| No login | Sign-in, accounts and the Users page are removed. A persona picker in the header replaces them |
| Sections split by persona (data centre, hyperscale, enterprise, policy) | Each persona sees its own dashboard, guided flow, workspace tabs and impact view |
| Keep the atlas's data sources | All 16 sources, the data jobs and `scripts/derived/` stay as they are. The Strategist's mock CSVs are not used |
| **Rules merged into the Glossary; data sources listed only in the Glossary** | Glossary tabs: Terms · Rules in force · Strategy library · Data sources. Elsewhere numbers carry a kind badge (Measured, Your data, Estimate, Assumption, No data), and short "Rules in force" boxes link to the Glossary |
| **Approvals page deleted; approval hierarchy taken from the shared design** | No Approvals page. Step 5 of the Guided flow follows the design: route bar (Requester → Approver 1 → Approver 2 → Audit trail), climate impact statement, the persona's approval hierarchy with the matching rule marked, justification, evidence, and the audit-trail record where each approver records their decision |
| **Integrate the atlas's strategies** | All 23 atlas strategies are levers in the Guided flow (under "Atlas strategy library", by category) and searchable in the Glossary's Strategy library tab |

## 2. Personas and what each one sees

Top menu: Home · Guided flow · My workspace · Dashboard · Earth view · Impact · Glossary.

| Section | Data centre operator | Colocation & hyperscale | Enterprise tenant | Policymaker |
|---|---|---|---|---|
| Home (Ask + workspaces) | ✓ | ✓ | ✓ | ✓ |
| Guided flow | Retrofit plan for a site | Where to build the next block | Where to run an AI workload | Growth policy package |
| Dashboard | Site resilience cockpit | Fleet risk & siting | Workload placement advisor | Regional observatory |
| My workspace | My sites · Expansion finder · Backup pairing · Manage hubs | same | same | Growth what-if · Impact ranking |
| Earth view · Impact | ✓ | ✓ | ✓ | ✓ |
| Glossary (terms, rules, strategies, data sources) | ✓ | ✓ | ✓ | ✓ |

The persona picker sits in the header. The choice is remembered in the browser, and changing persona changes the sections at once.

## 3. How the Strategist's engine runs on atlas data

The Strategist's engine is kept as it works in the design:
- inputs, then metrics with targets, then levers;
- each lever is classed no-regret, trade-off or maladaptation, from whether it worsens a metric (or a climate-critical metric), plus the atlas's own rules for the place (e.g. warmer inlets are maladaptation where heat is 70+);
- "AI best fit" scores targets met first, then the objective, then cost, with a heavy penalty for maladaptation. With the atlas strategies added there can be up to 22 levers, so it tries every combination of the 12 strongest (4,096);
- the approval route comes from the design's approval rules.

Each number is one of five kinds:
- **Measured:** from an atlas source.
- **Your data:** uploaded or typed by the user.
- **Estimate:** a simple formula, such as latency from distance.
- **Assumption:** a lever effect or cost with no open source, shown with an "Assumption" badge.
- **No data:** dropped from the targets, with the reason shown.

### 3.1 Data centre operator: retrofit plan

| Metric | Source | Kind |
|---|---|---|
| PUE | Uploaded hourly meter file (Σ facility ÷ Σ IT); target from the country rule in the rulebook | Your data |
| WUE | Uploaded file with an optional `water_litres` column; otherwise left out | Your data / No data |
| Resilience score (climate-critical) | 100 − atlas overall risk (all 8 hazards) for the chosen horizon and pathway | Measured |
| Water stress exposure (climate-critical) | Atlas water hazard after levers (Aqueduct) | Measured |
| Capex ($M) | Design levers: the design's values. Atlas strategies: $ = $0.5M, $$ = $3M, $$$ = $8M | Assumption |

- **Levers:** the design's five, mapped onto atlas strategies (liquid; hybrid + recl; waste; inlet; batt), plus flood barriers and a second feed. Then 9 more from the atlas library (chill, tes, drought, raise, storm, dr, run, disc, compact).
- **Data-quality gate:** the meter file must be at least 90% complete (the sample file with gaps is 84%).

### 3.2 Colocation & hyperscale: where to build

| Metric | Source | Kind |
|---|---|---|
| Grid carbon g/kWh | Ember national intensity (latest year) | Measured |
| Water risk /5 (climate-critical) | WRI Aqueduct score at the site for the horizon | Measured |
| Overall climate risk (climate-critical) | Atlas overall risk | Measured |
| Latency to users | Straight-line distance ÷ 66.7 km/ms + 5 ms | Estimate |
| Capex index | Design levers from the design; atlas strategies $ = +1, $$ = +4, $$$ = +10 | Assumption |
| Design PUE by climate zone | No open benchmark | No data |

- **Levers:** move to the lowest-risk other hub in the same market (real difference), liquid cooling, evaporative cooling (maladaptation where water is critical), 24/7 PPA and battery (carbon effects are market-based assumptions), plus 17 atlas strategies.

### 3.3 Enterprise tenant: where to run a workload

| Metric | Source | Kind |
|---|---|---|
| Carbon per 1,000 inferences | kWh per 1,000 inferences (typed) × the region's grid g/kWh (Google Cloud region data 2025) | Your data × Measured |
| Host heat risk (climate-critical) | Atlas heat hazard at the region's hub | Measured |
| Host overall climate risk | Atlas overall risk | Measured |
| p95 latency | Distance estimate | Estimate |
| Cost index | Lever effects; atlas strategies $ = +1, $$ = +3, $$$ = +6 | Assumption |
| Water per 1,000 inferences | No per-region water data published | No data |

- **Levers:** move to the lowest-carbon allowed region (residency, SLA), smaller model (−35%), renewable option (market-based), move to Jakarta for cost, batch into low-carbon hours (disabled until an Electricity Maps key is set), plus 6 atlas strategies.
- Percentages compound instead of adding (the design added them).

### 3.4 Policymaker: growth policy package

| Metric | Source | Kind |
|---|---|---|
| Sector emissions (% vs no policy) | Electricity × Ember intensity | Measured + assumption |
| Water drawn in stressed basins (climate-critical) | Cooling water × Aqueduct stress | Measured + assumption (WUE) |
| Climate risk at growth sites (climate-critical) | Atlas overall risk at the place, after strategies | Measured |
| Electricity for data centres | MW × 70% × 8,760 h × PUE | Measured + your growth input |
| Grid shortfall (MW) | No open grid-headroom data (India shows Grid-India energy not supplied as context) | No data |
| Investment change | No source | No data |

- **Levers:** PUE ≤ 1.3 standard, 50% clean-power requirement, water-free cooling (a trade-off: +3% electricity), steering new builds to a less water-stressed place in the same country, plus 7 atlas strategies (due diligence, permits tied to capacity, reclaimed water, drought plans, disclosure, waste heat, community compacts).
- **Pooled operator figures (k ≥ 5):** fictional until decision 2 is made.

## 4. Approval hierarchy (from the shared design)

From the design's `approval_rules.csv` and `users_roles.csv`:

| Persona | When | Approver 1 | Approver 2 |
|---|---|---|---|
| Data centre operator | Capex up to $5M | Facility lead | – |
| | Capex above $5M | Facility lead | Capex committee |
| | Japan and PUE above 1.4 | Facility lead | Energy manager (METI rationalisation plan) |
| Colocation & hyperscale | Block under 200 MW | Investment committee | – |
| | Block of 200 MW or more | Investment committee | Board |
| Enterprise tenant | Any placement change | Workload owner | – |
| | Cost index above 100 | Workload owner | FinOps |
| | Reporting under Korea | Workload owner | AI compliance lead |
| Policymaker | Any publication | Policy director | Minister |

Roles from the design: operators are editors; hyperscale and enterprise have editors (build and send) and approvers (sign their step); policy has viewers and editors. With no login, people type their name. Each decision needs a reason and goes into the hash-chained audit trail, which "Verify audit trail" re-checks.

## 5. Screens: what comes from where

| Merged screen | From the Strategist | From the atlas |
|---|---|---|
| Home | Persona cards, shared layers, AI register (real model names, no made-up eval scores) | Gemini Ask (`/api/parse`), top-risk table |
| Guided flow | All 6 steps, Watch a sample run, guards, best fit, the step 5 approval screen and audit trail | Data for every metric, the 23 strategies as levers |
| Dashboard | Persona layout, AI recommendation, rules in force, inputs / filters / outputs | Hazards, carbon, fleet, regions |
| My workspace | – | My sites, Expansion finder, Backup pairing, Manage hubs, Growth what-if, Impact ranking (moved over as they are) |
| Earth view | Before/after petals, scenario controls | 8 hazards, 62 hubs, sea level, live and news buttons |
| Impact | Before vs after per persona | The persona's guided-run results |
| Glossary | ⓘ on every term | Terms, rulebook (20 rules with sources), strategy library, data sources |

**Removed:** sign-in and Users; Approvals page; separate Rules and Data sources pages; the atlas's Map & ranking, Hub detail, Compare and How to read pages.

## 6. What is affected in the code

| Area | Change | Size |
|---|---|---|
| `public/index.html`, `app.js`, `ai.js`, `workspace.js`, `reports.js`, `admin.js`, `styles.css` | Replaced by the new front end (`strategist.*` from the preview, split into modules). Expansion finder, backup pairing, what-if, ranking and hub management logic move over unchanged | Large |
| `public/login.html`, `login.js`, `users.js` | Deleted | Small |
| `app/main.py` | Sign-in gate, `/api/auth/*` and `/api/admin/users` removed. Hub endpoints open to all (decision 1). `/api/parse` uses the persona sent by the page, and its prompt is reworded for the Strategist screens (today Gemini's replies still mention "hub detail view") | Medium |
| `app/auth.py`, `app/users.py` | Retired (kept in a backup folder for a month) | Small |
| `app/sites.py` | `user_id` → one shared list for the team, with a `persona` tag; the 25-site cap becomes a team cap (e.g. 100) | Medium |
| `app/alerts.py` | Per-user watches become team-wide | Small |
| New: `app/approvals.py` | Requests and the hash-chained audit trail, stored in `instance/atlas.db` (decision 3) | Medium |
| `app/news.py`, `live.py`, `ai.py`, `scoring.py`, `rules.py`, `hubs.py`, `store.py` | Unchanged | – |
| `jobs/`, `scripts/derived/`, `hazards.json`, `data.js` | Unchanged: all data sources kept | – |
| Tests | `auth_test` dropped. Sites, alerts and approvals tests rewritten. New front-end smoke test per persona | Medium |
| README / server setup | No admin account step. Add a warning: the server must stay on the internal network | Small |

## 7. Risks to know about

1. **No login and fully open hub management.** Anyone who can reach the server can add or delete hubs, run 25-second data builds, use the Gemini quota and record approvals under any name. Keep the server on the internal network or VPN only; the existing rate limits stay.
2. **Lever effects and costs with no open source** (PUE savings, capex, PPA, smaller model, cost bands for atlas strategies) are shown as Assumptions, never as data.
3. **2040 horizon.** Atlas sources give today, 2030 and 2050. The Strategist's 2040 becomes 2050; nothing is interpolated.
4. **Things the design shows that have no data:** hourly grid carbon (needs an Electricity Maps key), grid headroom outside India, design PUE benchmarks, per-region cloud water use, investment response. Each shows "No data" with the reason.

## 8. Decisions

All decided 16 Oct 2026:

1. **Manage hubs: fully open.** No key. The server must stay on the internal network or VPN.
2. **Meter uploads: summary only.** One row per upload (country, size group, PUE, WUE, completeness); hourly readings are never kept. Policy's pooled figures use these rows and hide groups under 5 operators.
3. **Audit trail: on the server, shared by the team.** Requests, decisions and the fingerprint chain live in `instance/atlas.db`; anyone can record their approval from their own computer.
4. **Assumptions: start blank.** Lever effects and costs with no open source count as zero until entered. A new **Assumptions** tab under My workspace (all personas) holds them, with who entered each value and why. Until filled, those levers show "No value entered yet", and capex/cost targets are left out of best fit.
5. **Old atlas screens: keep under a "More" menu.** Map & ranking, Hub detail and Compare stay reachable, restyled to match the new app. *Superseded on 17 Oct 2026 (section 10, decision B): these fold into Earth view and "More" leaves the menu.*

## 9. Build order (after you approve)

1. Remove login; make sites, alerts and the audit trail team-wide (server) and update tests.
2. Front-end shell: persona picker, sections per persona, Home with Ask.
3. Guided flow engine, the four persona configs and the atlas strategies as levers.
4. Step 5 approval screen with the design's hierarchy and the server audit trail.
5. Dashboards, Impact and Earth view.
6. My workspace tabs (including Manage hubs) and the Glossary tabs.
7. Full test on a copy, then swap `index.html` and update the README / server steps.

Your current atlas keeps running unchanged until step 7.

## 10. Review of 17 Oct 2026 (issues.docx, 15 points)

Full plan with each point, what was found and the fix: https://claude.ai/artifact/1JxETDUxpLDXUhUHdhA4Qo

Decisions (17 Oct 2026):

- **A. Scope: JAPAC on every screen.** Every screen shows only the 27 Asia-Pacific places; home counts match; the 3 internal PUE targets are counted apart from the 17 sourced rules; countries with no rule say so.
- **B. "More" folds into Earth view.** Map & ranking and Compare become Earth view tabs, place details open from any place name, "More" leaves the menu (replaces decision 5).
- **C. Persona names:** Data centre operator · Colocation & hyperscaler · Enterprise tenant · Policy maker, used everywhere. No short names.

Phases:

1. **Wording (done 17 Oct 2026):** one persona name everywhere (lever tabs now "<persona> levers"), "atlas" removed from screen text and AI prompts, footer note removed, "Watch a sample run" beside the page title, spell check (no misspellings found; British spelling kept).
2. **One scope (done 17 Oct 2026):** points 4, 5, 7. `SCOPE="Asia-Pacific"` in `public/app.js` filters every place list (27 places); region tabs removed from Earth view, Map & ranking, Manage hubs and Expansion finder; Ask is given only places in scope; Add site / Add hub refuse places outside it; team sites outside it are listed and marked "Outside JAPAC scope" but left out of totals and pickers. Home and the Rules tab count 17 sourced rules + 3 internal targets and name the 6 countries with none. The Glossary and Home count only sources used by places in scope (18; EIA-861 and Hydro-Quebec drop out). Colour by keeps hazards that vary across the places shown and marks today-only ones, with a note when 2030/2050 is picked. Later on 17 Oct the user asked to drop volcanoes, earthquakes and wildfire from Colour by only (`LAYER_SKIP`); they stay in every score and in Place detail. Sample sites: Frankfurt -> Inzai (Chiba, Japan), Amsterdam -> Singapore (Jurong West); My sites summary separates team sites from samples.
3. **One workspace (done 17 Oct 2026):** points 6, 12, 14. Menu is Home · My workspace · Dashboard · Earth view · Impact · Glossary (one line from 1024 px). The guided flow is the last My workspace tab for every persona (`#/work/guided`; `#/guided` redirects). More is folded into Earth view tabs (Hazard view, Map & ranking, Place detail, Compare; `#/more/...` redirects). Each persona's guided-flow inputs (`S.runs[p].f`) are the one shared set: Growth what-if reads and writes them (policy horizon gains +50 years), a "Working on" bar shows them on My workspace and the Dashboard, and "Plan this" buttons (My sites, Expansion finder for colocation, Impact ranking, Place detail) set them and open the guided flow, never switching persona. Sample sites are plannable (offered to their own persona).

## 11. Real data round (17 Oct 2026)

Asked: "why always Chennai?" and "make it work with real data from APIs or CSV files, with the japan-data-centers project as the visual reference". Decisions: real facilities as example sites; remember the last place; Leaflet with map tiles; CSV + PeeringDB API through a data job.

- **Chennai** came from three of four Example 1s, per-tab `sessionStorage` (every visit restarted on Example 1), hard-coded fallbacks and Chennai-only warming stripes. Now: inputs are kept in `localStorage`; Example 1 is Chennai (operator), Kuala Lumpur (colocation), Singapore (tenant), Jakarta (policy maker); fallbacks use the persona's own example; the stripes follow the working place (NASA POWER, `/api/stripes`).
- **Real data centres**: `jobs/sources/facilities.py` merges the OpenStreetMap extract (CSV) with PeeringDB's facility API into `public/facilities.json` (1,507 facilities, 142 in both). Used by Earth view · Data centres (Leaflet + markercluster + heat from cdnjs, keyless OpenStreetMap tiles; CARTO now needs a key), Place detail, the 50 km counts and "Add to team sites".
- **Example sites** are now nine real facilities (no MW: no open source has it).
- Sample meter files remain fictional: no public per-site meter data exists.

