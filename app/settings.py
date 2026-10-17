"""Settings and shared constants. Values come from the environment, then from .env next to the app;
anything already set in the environment (shell, systemd, Cloud Run secrets) wins."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DATA_JS = PUBLIC / "data.js"
HAZARDS_JSON = PUBLIC / "hazards.json"
HAZARDS_JS = PUBLIC / "hazards.js"
META_JSON = ROOT / "scripts" / "hub-meta.json"
CACHE_DIR = ROOT / "scripts" / ".cache"


def load_env_file(path: Path = ROOT / ".env") -> bool:
    """Minimal .env reader: KEY=value lines, # comments, optional quotes. Existing variables are kept."""
    if not path.exists():
        return False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)
    return True


ENV_LOADED = load_env_file()


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def env_list(name: str, default: str) -> list[str]:
    return [x.strip() for x in (env(name) or default).split(",") if x.strip()]


PORT = int(env("PORT", "8080") or 8080)
HOST = env("HOST", "") or "0.0.0.0"
MOCK = env("MOCK_AI") == "1"
TIMEOUT_MS = int(env("AI_TIMEOUT_MS", "20000") or 20000)
GEMINI_MODELS = env_list("GEMINI_MODEL", "gemini-flash-latest,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest")
GROQ_KEY = env("GROQ_API_KEY")
GROQ_MODELS = env_list("GROQ_MODEL", "openai/gpt-oss-120b,openai/gpt-oss-20b")
GROQ_URL = (env("GROQ_BASE_URL") or "https://api.groq.com/openai/v1").rstrip("/")

# Trust one proxy hop (nginx on EC2, Google's front end on Cloud Run) for the visitor's address, so a
# client can't pick its own with a forged X-Forwarded-For. TRUST_PROXY=0 when nothing is in front.
_tp = env("TRUST_PROXY", "")
TRUST_PROXY = int(_tp) if _tp.strip().lstrip("-").isdigit() else 1

ADMIN_TOKEN = env("ADMIN_TOKEN")
# Accounts and sites database; never deployed over or committed. ATLAS_INSTANCE_DIR points a test copy elsewhere.
INSTANCE_DIR = Path(env("ATLAS_INSTANCE_DIR") or ROOT / "instance")
ON_CLOUD = bool(env("K_SERVICE"))
# Public demo: refuse hub and news-feed edits so nobody can break the shared hub list (the page says so).
DEMO_LOCK_HUBS = env("DEMO_LOCK_HUBS").strip().lower() in ("1", "on", "true", "yes")
# Google Analytics 4 measurement ID (G-...). Public by design; the page loads the tag only after the visitor allows it.
GA_MEASUREMENT_ID = env("GA_MEASUREMENT_ID").strip()
# Extra addresses whose pages may post to this app, e.g. the Firebase Hosting site in front of Cloud Run.
ALLOWED_ORIGINS = [o.strip().rstrip("/").split("://", 1)[-1] for o in env("ALLOWED_ORIGINS").split(",") if o.strip()]
SESSION_HOURS = float(env("SESSION_HOURS", "12") or 12)

# Options shared with the front end.
AUD = ["op", "colo", "ten", "pol"]          # colocation and hyperscale providers share one role
PRIO = ["bal", "quick", "imp"]
LAYER = ["comp", "heat", "flood", "water", "grid", "cyclone", "volcano", "earthquake", "wildfire"]
HORIZON = ["today", "2030", "2050"]
PATHWAY = ["mod", "high"]
REGIONS = ["Global", "Americas", "Europe", "Africa & Middle East", "Asia-Pacific"]
TABS = ["hub", "port", "lib"]
INTENTS = ["site", "assess", "compare", "explore", "impact"]
