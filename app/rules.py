"""Rule-based fallback for when neither Gemini nor Groq answers. Deterministic, so the atlas keeps working
offline or when quotas run out. Also double-checks the AI on question type and named areas."""
import copy
import json
import re
import unicodedata

from .settings import META_JSON

AUD_NAME = {"op": "data centre operator", "colo": "colocation & hyperscaler", "ten": "enterprise tenant", "pol": "policy maker or regulator"}
LAYER_NAME = {"comp": "composite risk", "heat": "heat", "flood": "flood", "water": "water stress", "grid": "grid reliability",
              "cyclone": "cyclones", "volcano": "volcanoes", "earthquake": "earthquakes", "wildfire": "wildfire"}
HAZ = ["heat", "flood", "water", "grid", "cyclone", "volcano", "earthquake", "wildfire"]
HAZ_LABEL = {"heat": "heat", "flood": "flooding", "water": "water stress", "grid": "grid reliability", "cyclone": "cyclones", "volcano": "volcanoes", "earthquake": "earthquakes", "wildfire": "wildfires"}
HAZ_CATEGORY = {"heat": "Cooling and heat", "flood": "Flood and storm", "water": "Water", "grid": "Power and grid", "cyclone": "Flood and storm", "volcano": "", "earthquake": "", "wildfire": ""}


def lower_first(s) -> str:
    s = str(s or "")
    return s[0].lower() + s[1:] if re.match(r"^[A-Z][a-z]", s) else s


def norm(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def word(t: str, w: str) -> bool:
    return re.search(r"(^|[^a-z0-9])" + re.escape(w) + r"([^a-z0-9]|$)", t) is not None


def any_of(t: str, words) -> bool:
    return any(word(t, w) or (len(w) > 6 and w in t) for w in words)


HAZ_WORDS = {
    "heat": ["heat", "hot", "heatwave", "temperature", "temperatures", "cooling"],
    "flood": ["flood", "floods", "flooding", "surge", "rain", "rainfall", "monsoon", "sea level"],
    "water": ["water", "drought", "droughts", "scarcity", "aquifer"],
    "grid": ["grid", "power", "outage", "outages", "electricity", "energy", "blackout", "blackouts"],
    "cyclone": ["cyclone", "cyclones", "typhoon", "typhoons", "hurricane", "hurricanes", "storm", "storms", "tropical storm"],
    "volcano": ["volcano", "volcanoes", "volcanic", "eruption", "eruptions", "ash"],
    "earthquake": ["earthquake", "earthquakes", "quake", "quakes", "seismic", "tremor", "tremors"],
    "wildfire": ["wildfire", "wildfires", "bushfire", "bushfires", "forest fire", "forest fires", "fire", "fires", "smoke"],
}
REGION_WORDS = {
    "Asia-Pacific": ["asia", "southeast asia", "south east asia", "south-east asia", "asean", "apac", "asia-pacific", "asia pacific", "pacific", "oceania"],
    "Europe": ["europe", "european", "eu", "emea"],
    "Americas": ["americas", "north america", "latin america", "south america", "us", "usa", "united states"],
    "Africa & Middle East": ["africa", "middle east", "gulf", "mena", "gcc"],
}
# Sub-regions people name that are narrower than the atlas regions, by hub country.
SUBREGIONS = [
    (["southeast asia", "south east asia", "south-east asia", "se asia", "asean", "sea region"], ["Singapore", "Malaysia", "Indonesia", "Philippines", "Thailand", "Vietnam"]),
    (["gulf", "gcc", "middle east"], ["United Arab Emirates", "Saudi Arabia", "Qatar", "Bahrain", "Oman", "Kuwait"]),
    (["nordics", "nordic", "scandinavia", "northern europe"], ["Sweden", "Norway", "Finland", "Denmark", "Ireland"]),
    (["south america"], ["Brazil", "Chile", "Colombia", "Argentina", "Peru", "Uruguay", "Ecuador"]),
    (["latin america", "latam"], ["Brazil", "Chile", "Mexico", "Colombia", "Argentina", "Peru", "Uruguay", "Ecuador", "Costa Rica", "Panama"]),
    (["east asia", "north asia"], ["China", "Japan", "South Korea", "Taiwan"]),
    (["south asia"], ["India", "Pakistan", "Bangladesh", "Sri Lanka"]),
]
# Parts of a country, by hub id. Hubs added later bring their own areas in hub-meta.json.
BASE_AREAS = [
    (["north india", "northern india", "ncr", "national capital region"], "North India", ["DEL"]),
    (["south india", "southern india"], "South India", ["MAA"]),
    (["west india", "western india"], "West India", ["BOM"]),
    (["us east coast", "east coast", "eastern us", "east of the us"], "US East Coast", ["ASH", "ATL"]),
    (["us west coast", "west coast", "pacific northwest", "western us"], "US West Coast", ["SJC", "QWA"]),
    (["midwest", "central us"], "US Midwest", ["ORD", "DFW"]),
    (["southern europe", "south europe", "mediterranean"], "Southern Europe", ["MAD", "MIL", "IST"]),
    (["western europe", "flap", "flap-d"], "Western Europe", ["LON", "FRA", "AMS", "DUB"]),
    (["east india", "eastern india"], "East India", []),
]
BASE_ALIASES = {"ASH": ["virginia", "ashburn"], "SJC": ["bay area", "san jose"], "DEL": ["delhi", "gurugram", "gurgaon", "noida"],
                "QWA": ["washington state", "quincy"], "NRT": ["tokyo"], "ICN": ["seoul"], "CGK": ["jakarta"], "GRU": ["sao paulo"], "QRO": ["queretaro"]}
SUBAREAS: list = []
ALIASES: dict = {}


def reload_meta() -> None:
    """Rebuild aliases and areas from the built-in lists plus hub-meta.json, so edits and removals take effect."""
    SUBAREAS.clear()
    SUBAREAS.extend((list(w), label, list(ids)) for w, label, ids in BASE_AREAS)
    ALIASES.clear()
    ALIASES.update(copy.deepcopy(BASE_ALIASES))
    try:
        meta = json.loads(META_JSON.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"rules: could not read {META_JSON.name}: {e}")
        return
    for hid, m in meta.items():
        if not isinstance(m, dict) or hid.startswith("_"):
            continue
        if isinstance(m.get("aliases"), list):
            ALIASES[hid] = list(dict.fromkeys((ALIASES.get(hid) or []) + m["aliases"]))
        for a in m.get("areas") or []:
            entry = next((e for e in SUBAREAS if e[1].lower() == str(a).lower()), None)
            if entry is None:
                entry = ([str(a).lower()], str(a), [])
                SUBAREAS.append(entry)
            if hid not in entry[2]:
                entry[2].append(hid)


reload_meta()


def area_hints() -> str:
    """Named parts of countries for the AI prompt, e.g. "North India = DEL; South India = MAA, HYD"."""
    return "; ".join(f"{label} = {', '.join(ids)}" for _, label, ids in SUBAREAS if ids)


# "What impact will 5 data centres have on Delhi?": the effect of data centres on a place, not the place's risk.
IMPACT = re.compile(r"\b(impact|impacts|effect|effects|footprint|strain|burden|pressure on|consume|consumption|draw|emissions?|carbon|power demand|electricity demand|energy demand|water use|water demand|water usage|power use|energy use|"
                    r"how much (power|water|electricity|energy)|what (would|will|does|do) .*(data ?cent(re|er)s?|dcs?) (do|mean|use|need))\b")
NOUN = r"(?:data ?cent(?:re|er)s?|dcs?|facilit(?:y|ies)|sites?|campus(?:es)?)"
SIZE = r"(?:\d{1,5}(?:\.\d+)?\s*(?:mw|megawatts?)\s+)?"
ADJ = r"(?:new |more |additional |hyperscale |large |small )?"
COUNT = re.compile(r"\b(\d{1,4})\b\s*" + ADJ + SIZE + ADJ + NOUN + r"\b")
WORD_NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
            "twenty": 20, "fifty": 50, "hundred": 100}
WORD_COUNT = re.compile(r"\b(" + "|".join(WORD_NUM) + r")\s+" + ADJ + SIZE + ADJ + NOUN + r"\b")
MW = re.compile(r"\b(\d{1,5}(?:\.\d+)?)\s*(?:mw|megawatts?)\b")


def impact_numbers(t: str) -> dict:
    """Number of data centres and MW per site named in the text (0 when not stated)."""
    m = COUNT.search(t) or WORD_COUNT.search(t)
    count = (int(m.group(1)) if m.group(1).isdigit() else WORD_NUM[m.group(1)]) if m else 0
    mw = MW.search(t)
    return {"dcCount": count, "dcMw": float(mw.group(1)) if mw else 0}


SITING = re.compile(r"\b(where|which (city|cities|market|markets|location|locations|hub|hubs|site|sites)|best (place|location|market|site|city)|"
                    r"good (place|location|market|site|city)|locate|location for|site selection|siting|build|put|set ?up|setup|establish|open|launch|"
                    r"expand|choose|pick|recommend|suitable|new (data ?cent(re|er)|dc|site|campus|facility))\b")


def rule_parse(text: str, hubs: list[dict], current: dict) -> dict:
    """Plain-English request -> atlas settings, by keyword matching."""
    t = norm(text)
    out = dict(current)
    changes = []

    roles = [("colo", ["colocation", "colo", "hyperscaler", "hyperscale provider", "cloud provider"]),
             ("pol", ["regulator", "regulators", "policymaker", "policy maker", "government", "ministry", "planner", "council"]),
             ("ten", ["tenant", "enterprise", "bank", "customer", "occupier"]),
             ("op", ["operator", "operate", "data centre owner", "data center owner"])]
    for k, ws in roles:
        if any_of(t, ws):
            out["aud"] = k
            break

    hz = [k for k in HAZ if any_of(t, HAZ_WORDS[k])]
    if len(hz) == 1:
        out["layer"] = hz[0]
    elif len(hz) > 1:
        out["layer"] = "comp"

    if re.search(r"\b2050\b|\b2040\b|long[- ]term|mid[- ]century", t):
        out["h"] = "2050"
    elif re.search(r"\b2030\b|\b2035\b|this decade|near[- ]term", t):
        out["h"] = "2030"
    elif any_of(t, ["today", "now", "current", "currently", "present"]):
        out["h"] = "today"

    if any_of(t, ["moderate", "ssp2", "ssp2-4.5", "middle of the road"]):
        out["p"] = "mod"
    elif any_of(t, ["high emissions", "worst case", "worst-case", "ssp5", "ssp5-8.5", "business as usual"]):
        out["p"] = "high"

    if any_of(t, ["quick", "quickly", "fast", "cheap", "low cost", "budget"]):
        out["prio"] = "quick"
    elif any_of(t, ["biggest impact", "maximum impact", "most impact", "largest impact", "biggest risk reduction", "whatever it takes"]):
        out["prio"] = "imp"
    elif any_of(t, ["balanced", "value for money"]):
        out["prio"] = "bal"

    # Hubs, in the order they are mentioned.
    found = []
    for h in hubs:
        names = [norm(h["n"])] + (ALIASES.get(h["id"]) or [])
        pos = -1
        for n in names:
            i = t.find(n)
            if i > -1 and word(t, n) and (pos < 0 or i < pos):
                pos = i
        if pos > -1:
            found.append({"id": h["id"], "pos": pos})
    # Countries pull in all their hubs when no city from that country was named.
    for c in dict.fromkeys(h["c"] for h in hubs):
        cn = norm(c)
        i = t.find(cn)
        if i > -1 and word(t, cn):
            in_country = [h for h in hubs if h["c"] == c]
            if not any(any(f["id"] == h["id"] for f in found) for h in in_country):
                for k, h in enumerate(in_country):
                    found.append({"id": h["id"], "pos": i + k / 10})
    found.sort(key=lambda f: f["pos"])
    ids = list(dict.fromkeys(f["id"] for f in found))

    region = None
    for r, ws in REGION_WORDS.items():
        if any_of(t, ws):
            region = r
            break
    if not region and ids:
        regs = list(dict.fromkeys(next(h["r"] for h in hubs if h["id"] == i) for i in ids))
        region = regs[0] if len(regs) == 1 else "Global"
    if region:
        out["region"] = region

    compare = any_of(t, ["compare", "comparing", "versus", "vs", "between", "portfolio", "across", "shortlist"])
    if len(ids) >= 2 or (compare and ids):
        out["pins"], out["site"], out["tab"] = ids[:20], ids[0], "port"
    elif len(ids) == 1:
        out["site"], out["tab"] = ids[0], "hub"
    elif region and region != "Global":
        cur = next((h for h in hubs if h["id"] == out["site"]), None)
        if not cur or cur["r"] != region:
            first = next((h for h in hubs if h["r"] == region), None)
            if first:
                out["site"] = first["id"]
        out["tab"] = "hub"

    # What kind of question this is, and which hubs it covers.
    siting = SITING.search(t) is not None
    cands, out["area"] = [], ""
    for ws, label, hub_ids in SUBAREAS:
        if any_of(t, ws):
            cands = [i for i in hub_ids if any(h["id"] == i for h in hubs)]
            out["area"] = label
            break
    if not cands:
        for ws, countries in SUBREGIONS:
            if any_of(t, ws):
                cands = [h["id"] for h in hubs if h["c"] in countries]
                out["area"] = re.sub(r"(^|\s)\S", lambda m: m.group(0).upper(), ws[0])
                break
    if not cands and ids:
        cands = list(ids)
    if not cands and region and region != "Global":
        cands = [h["id"] for h in hubs if h["r"] == region]
    out["candidates"] = cands
    impact = IMPACT.search(t) is not None and not re.search(r"\b(where|which)\b", t)
    out["intent"] = "impact" if impact else "site" if siting else "compare" if len(ids) >= 2 else "assess" if len(ids) == 1 else "explore"
    out.update(impact_numbers(t))
    if out["intent"] in ("site", "impact"):
        out["tab"], out["pins"] = "hub", current["pins"]

    if out["aud"] != current["aud"]:
        changes.append(f"role to {AUD_NAME[out['aud']]}")
    if out["layer"] != current["layer"]:
        changes.append(f"map to {LAYER_NAME[out['layer']]}")
    if out["region"] != current["region"]:
        changes.append(f"region to {out['region']}")
    if out["h"] != current["h"] or out["p"] != current["p"]:
        changes.append("scenario to " + ("today" if out["h"] == "today" else f"{out['h']}, {'high' if out['p'] == 'high' else 'moderate'} emissions"))
    if out["tab"] == "port" and out["pins"]:
        changes.append(f"comparison of {len(out['pins'])} hubs")
    elif out["site"] != current["site"]:
        changes.append(f"hub to {next((h['n'] for h in hubs if h['id'] == out['site']), out['site'])}")
    out["reply"] = (f"I matched keywords and set the {', '.join(changes)}." if changes
                    else "I couldn't match any settings from that. Try naming a city, hazard, role or year.")
    return out


def _lead_max(s: dict) -> int:
    m = re.search(r"(\d+)\D+(\d+)", str(s.get("leadTime", "")))
    return int(m.group(2)) if m else 12


def rule_brief(scope: str, scenario: dict, hubs: list[dict], strategies: list[dict]) -> dict:
    totals = {k: 0 for k in HAZ}
    for h in hubs:
        for k in HAZ:
            totals[k] += h["scores"].get(k) or 0
    ranked = sorted(HAZ, key=lambda k: -totals[k])
    top, first = ranked[0], strategies[0]
    where = "today" if scenario["horizon"] == "today" else f"by {scenario['horizon']} on a {scenario['pathway']} pathway"
    if scope == "portfolio":
        worst = max(hubs, key=lambda h: h["composite"] or 0)
        headline = f"Across {len(hubs)} hubs, {HAZ_LABEL[top]} is the most widespread risk; the first step is to {lower_first(first['title'])}."
        summary = (f"{worst['name']} carries the highest composite score at {worst['composite']} ({worst['band'].lower()}) {where}. "
                   "Measures that help several sites come first, with long-lead projects planned for the hubs that need them most.")
    else:
        h = hubs[0]
        d = (h["composite"] or 0) - (h["compositeToday"] or 0)
        score = h["scores"].get(top)
        headline = f"{h['name']}: {HAZ_LABEL[top]} is the main risk at {score if score is not None else 'no data'} of 100; the first step is to {lower_first(first['title'])}."
        change = "" if scenario["horizon"] == "today" else f", {'up' if d >= 0 else 'down'} {abs(d)} points from today"
        summary = (f"The composite score is {h['composite']} ({h['band'].lower()}) {where}{change}. For a {str(scenario['audience']).lower()}, "
                   "quick, low-cost steps come first while long-lead projects are scoped in parallel.")
    buckets = [("Act now", "0 to 6 months", lambda m: m <= 6), ("Build in", "6 to 18 months", lambda m: 6 < m <= 18),
               ("Plan long-lead projects", "18 months and beyond", lambda m: m > 18)]
    phases = []
    for name, timeframe, test in buckets:
        acts = [{"strategy": s["title"], "rationale": ((f"Cuts {s['riskReduction']}. " if s.get("riskReduction") else "") + s.get("note", "")).strip()}
                for s in strategies if test(_lead_max(s))][:3]
        if acts:
            phases.append({"name": name, "timeframe": timeframe, "actions": acts})
    titles = " | ".join(s["title"].lower() for s in strategies)
    max_grid = max([h["scores"].get("grid") or 0 for h in hubs] or [0])
    tradeoffs = []
    if "hybrid" in titles or "closed-loop" in titles:
        tradeoffs.append("Hybrid or closed-loop cooling saves water but adds electricity demand" + (f", on a grid already scoring {max_grid}" if max_grid >= 50 else "") + ".")
    if "liquid" in titles:
        tradeoffs.append("Liquid cooling needs new plant and skills, so phase it in with planned refits.")
    if "batter" in titles or "microgrid" in titles:
        tradeoffs.append("On-site batteries bring fire-safety and heat-management requirements.")
    if "spread critical workloads" in titles:
        tradeoffs.append("Spreading workloads across regions needs latency and data-residency checks.")
    if "warmer inlet" in titles:
        tradeoffs.append("Warmer inlet temperatures must stay within equipment warranty limits.")
    if not tradeoffs:
        tradeoffs.append("Long-lead projects tie up capital early, so confirm them with site-level studies first.")
    q = {"water": "What supply restrictions apply in dry years, and can reclaimed water be supplied to the site?",
         "grid": "What firm capacity, outage history and lead time for a second feed can the utility confirm?",
         "flood": "Do the local flood maps include future climate scenarios, and what design levels do they set?",
         "heat": "How do cooling plant and IT equipment perform at the projected design-day temperatures?"}
    highs = [k for k in ranked if any((h["scores"].get(k) or 0) >= 50 for h in hubs)]
    questions = [q[k] for k in (highs or [top])[:3]]
    return {"headline": headline, "summary": summary, "phases": phases, "tradeoffs": tradeoffs[:3], "questions": questions}


def rule_answer(question: str, hub: dict, scenario: dict, strategies: list[dict], evidence: dict | None = None) -> str:
    t = norm(question)
    hz = next((k for k in HAZ if any_of(t, HAZ_WORDS[k])), None)
    sc = hub["scores"]
    if hz and sc.get(hz) is None:
        return (f"There is no measured {HAZ_LABEL[hz]} data for {hub['name']}, so the app does not score it and leaves it out of the overall score. "
                "It is not estimated from other hubs. Ask about one of its measured hazards instead.")
    top = sorted(HAZ, key=lambda k: -(sc.get(k) or 0))[0]
    when = "today" if scenario["horizon"] == "today" else f"in {scenario['horizon']} on a {scenario['pathway']} pathway"
    ev = evidence or {}
    if hz:
        match = [lower_first(s["title"]) for s in strategies if s["category"] == HAZ_CATEGORY[hz]][:2]
        pos = "the highest of its hazards" if hz == top else f"compared with {HAZ_LABEL[top]} at {sc.get(top)}, its highest"
        return (f"{hub['name']} scores {sc[hz]} of 100 for {HAZ_LABEL[hz]} {when}, {pos}. "
                + (f"The ranked strategies that target it are to {' and to '.join(match)}." if match
                   else "None of the top-ranked strategies for your role target it directly; check the strategy library.")
                + (f" Basis: {ev[hz]}." if ev.get(hz) else "")
                + " This is a rule-based summary of the hazard data, so it can't explain causes in detail.")
    return (f"{hub['name']} has a composite score of {hub['composite']} ({hub['band'].lower()}) {when}. Its highest hazard is {HAZ_LABEL[top]} at {sc.get(top)} of 100"
            + (f", and the top-ranked strategy for your role is to {lower_first(strategies[0]['title'])}." if strategies else ".")
            + (f" Basis for {HAZ_LABEL[top]}: {ev[top]}." if ev.get(top) else "")
            + " This is a rule-based summary; ask about heat, flooding, water, the grid, cyclones, volcanoes, earthquakes or wildfires for more detail.")
