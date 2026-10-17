"""Run the atlas: python -m app  (PORT and HOST come from the environment or .env; defaults 8080 and all addresses)."""
import sys

import uvicorn

from . import ai, gcp
from .settings import ENV_LOADED, GEMINI_MODELS, GROQ_KEY, GROQ_MODELS, HOST, MOCK, PORT

if __name__ == "__main__":
    if ENV_LOADED:
        print("Loaded settings from .env")
    gcp.restore()          # Cloud Run: bring back the team's records before anything opens them (off without GCS_BUCKET)
    chain = "mock" if MOCK else "  then  ".join(x for x in [f"Gemini ({' > '.join(GEMINI_MODELS)})" if ai.client else None,
                                                             f"Groq ({' > '.join(GROQ_MODELS)})" if GROQ_KEY else None, "rules"] if x)
    print(f"Adaptation Atlas on http://localhost:{PORT}\nAI chain: {chain}")
    # uvicorn exits with an error (and a non-zero code) if the port is already in use.
    sys.exit(uvicorn.run("app.main:app", host=HOST, port=PORT, log_level="warning", proxy_headers=False) or 0)
