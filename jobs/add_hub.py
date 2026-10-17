"""Add (or update, or remove) data centre hubs from the command line. The app's Manage hubs page does the same.

    One hub:
      python -m jobs.add_hub --id HYD --name Hyderabad --country India --region Asia-Pacific \\
        --lat 17.39 --lon 78.49 --iso3 IND --iso2 IN --zone IN-SO --areas "South India" --aliases "cyberabad"
    Many hubs from a JSON file (an array of objects with the same keys):
      python -m jobs.add_hub --file scripts/new-hubs.json
    Remove a hub:
      python -m jobs.add_hub --remove HYD
    --dry-run prints what would change without writing; --force allows a hub on top of another.

Then run `python -m jobs.build_hazards` to fetch its open data. Grid reliability and the change in flood risk have no
open source: pass --grid "today,change" and --flood-change N if you have measured values; otherwise they show as
"no data". Nothing is copied from other hubs.
"""
import json
import sys
from pathlib import Path

from app import hubs


def parse_args(argv: list[str]) -> dict:
    args, i = {}, 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            k = a[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                args[k], i = argv[i + 1], i + 2
                continue
            args[k] = True
        i += 1
    return args


def main() -> int:
    args = parse_args(sys.argv[1:])
    if args.get("help") or not (args.get("id") or args.get("file") or args.get("remove")):
        print(__doc__)
        return 0 if args.get("help") else 1
    st = hubs.load()
    removed = []
    try:
        if args.get("remove"):
            for hid in hubs.as_list(args["remove"]):
                removed.append(hubs.remove(st, hid)["id"])
                print(f"Removed {removed[-1]}")
        else:
            items = json.loads(Path(args["file"]).read_text(encoding="utf-8")) if args.get("file") else [args]
            for o in items:
                if "flood-change" in o and "floodChange" not in o:
                    o["floodChange"] = o["flood-change"]
                r = hubs.upsert(st, o, force=bool(args.get("force")))
                h, m = r["hub"], r["meta"]
                print(f"{'Updated' if r['updated'] else 'Added'} {r['id']} {h['n']}, {h['c']} at map {h['x']},{h['y']}"
                      + (f"\n    your values: {m['own']}" if m.get("own") else "") + "".join(f"\n  ! {w}" for w in r["warnings"]))
    except hubs.HubError as e:
        print(f"Error: {e}\nNothing was written.")
        return 1
    if args.get("dry-run"):
        print("--dry-run: nothing written.")
        return 0
    hubs.save(st)
    if removed:
        hubs.drop_hazards(removed)
    print(f"Now {len(st['map']['hubs'])} hubs. Next: python -m jobs.build_hazards, then restart the server.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
