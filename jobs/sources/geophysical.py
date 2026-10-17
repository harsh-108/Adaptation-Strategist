"""Volcanoes (Smithsonian Global Volcanism Program) and earthquakes (USGS catalogue). Geophysical hazards: they
don't change with emissions, so the same value applies to every horizon and pathway."""
from ..common import get_json, js_round, km

CONFIG = {
    "volcanoRadiusKm": 100,
    "quakeRadiusKm": 300, "quakeMinMag": 6, "quakeFromYear": 1950, "quakeToYear": 2024, "quakesPerDecadeFor100": 8,
}
SOURCES = [
    {"id": "gvp", "name": "Smithsonian Global Volcanism Program, Holocene volcanoes", "url": "https://volcano.si.edu/", "licence": "Public, cite Global Volcanism Program 2024", "used": "Volcanoes"},
    {"id": "usgs", "name": "USGS earthquake catalogue (ComCat)", "url": "https://earthquake.usgs.gov/earthquakes/search/", "licence": "Public domain (USGS)", "used": "Earthquakes"},
]
GVP = ("https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=1.0.0&request=GetFeature"
       "&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json")


class Volcanoes:
    @staticmethod
    def prepare(warn):
        feats = get_json(GVP).get("features") or []
        out = []
        for f in feats:
            p, g = f.get("properties") or {}, f.get("geometry") or {}
            co = g.get("coordinates") or []
            if len(co) >= 2:
                last = p.get("Last_Eruption_Year")
                out.append({"name": p.get("Volcano_Name"), "country": p.get("Country"), "lon": co[0], "lat": co[1],
                            "last": int(last) if isinstance(last, (int, float)) else None})
        print(f"GVP: {len(out)} Holocene volcanoes", flush=True)
        return out

    @staticmethod
    def for_hub(vols, hid, lat, lon, warn):
        r = CONFIG["volcanoRadiusKm"]
        near = sorted(((km(lat, lon, v["lat"], v["lon"]), v) for v in vols), key=lambda x: x[0])
        within = [(d, v) for d, v in near if d <= r]
        # Score: the closest, most recently active volcano within the radius. Proximity 1 at the hub to 0 at the edge;
        # erupted since 1900 counts fully, since 1500 at 60%, older or unknown at 30%.
        def weight(v):
            y = v["last"]
            return 1.0 if y is not None and y >= 1900 else 0.6 if y is not None and y >= 1500 else 0.3
        score = js_round(100 * max([(1 - d / r) * weight(v) for d, v in within] or [0]))
        if within:
            d, v = within[0]
            recent = [x for x in within if x[1]["last"] is not None and x[1]["last"] >= 1900]
            summary = (f"{len(within)} Holocene volcano(es) within {r} km; nearest {v['name']} at {js_round(d)} km"
                       + (f", {len(recent)} erupted since 1900" if recent else "") + " (Smithsonian GVP)")
        else:
            d, v = near[0] if near else (None, None)
            summary = f"no Holocene volcano within {r} km" + (f"; nearest is {v['name']} at {js_round(d)} km" if v else "") + " (Smithsonian GVP)"
        return {"kind": "modelled", "src": ["gvp"], "t": score, "geophysical": True,
                "raw": {"within": len(within), "nearestKm": js_round(near[0][0]) if near else None, "nearest": near[0][1]["name"] if near else None},
                "summary": summary,
                "basis": f"{summary[0].upper() + summary[1:]}. Score uses the closest, most recently active volcano within {r} km. Doesn't change over time."}


class Earthquakes:
    @staticmethod
    def prepare(warn):
        return True   # one query per hub, cached

    @staticmethod
    def for_hub(_, hid, lat, lon, warn):
        c = CONFIG
        base = (f"https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson&starttime={c['quakeFromYear']}-01-01&endtime={c['quakeToYear']}-12-31"
                f"&latitude={lat}&longitude={lon}&maxradiuskm={c['quakeRadiusKm']}")
        n6 = get_json(base + f"&minmagnitude={c['quakeMinMag']}", gap_s=0.3).get("count", 0)
        n7 = get_json(base + "&minmagnitude=7", gap_s=0.3).get("count", 0)
        years = c["quakeToYear"] - c["quakeFromYear"] + 1
        per_dec = n6 / years * 10
        score = js_round(min(100, per_dec / c["quakesPerDecadeFor100"] * 100))
        summary = f"{n6} earthquakes of magnitude {c['quakeMinMag']}+ within {c['quakeRadiusKm']} km in {c['quakeFromYear']}-{c['quakeToYear']} ({n7} of 7+) (USGS)"
        return {"kind": "modelled", "src": ["usgs"], "t": score, "geophysical": True,
                "raw": {"m6": n6, "m7": n7, "years": years, "perDecade": js_round(per_dec, 1)},
                "summary": summary,
                "basis": f"{summary[0].upper() + summary[1:]}. Score = magnitude-{c['quakeMinMag']}+ quakes per decade ({c['quakesPerDecadeFor100']} = 100). Doesn't change over time."}
