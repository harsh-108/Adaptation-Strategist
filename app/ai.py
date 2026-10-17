"""AI providers: Gemini first (retrying busy models and moving down the model list), then Groq, and the
caller falls back to the rule engine. Each answer is labelled with what produced it."""
import asyncio
import json
import re

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from .settings import GEMINI_MODELS, GROQ_KEY, GROQ_MODELS, GROQ_URL, MOCK, TIMEOUT_MS, env

# Option A (simplest): GEMINI_API_KEY from Google AI Studio.
# Option B: Vertex AI with the server's service account: GOOGLE_GENAI_USE_VERTEXAI=true, GOOGLE_CLOUD_PROJECT,
#           GOOGLE_CLOUD_LOCATION.
client = None
mode = "rules"
if MOCK:
    mode = "mock"
elif env("GOOGLE_GENAI_USE_VERTEXAI") == "true":
    client = genai.Client(vertexai=True, project=env("GOOGLE_CLOUD_PROJECT") or None, location=env("GOOGLE_CLOUD_LOCATION") or "global",
                          http_options=types.HttpOptions(timeout=TIMEOUT_MS))
    mode = "vertex"
elif env("GEMINI_API_KEY"):
    client = genai.Client(api_key=env("GEMINI_API_KEY"), http_options=types.HttpOptions(timeout=TIMEOUT_MS))
    mode = "api-key"


class ProviderError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def status_of(err: BaseException) -> int:
    if isinstance(err, ProviderError) and err.status:
        return err.status
    if isinstance(err, genai_errors.APIError) and getattr(err, "code", None):
        return int(err.code)
    if isinstance(err, httpx.TimeoutException) or isinstance(err, asyncio.TimeoutError):
        return 504
    m = str(err)
    if re.search(r"RESOURCE_EXHAUSTED|quota", m, re.I):
        return 429
    if re.search(r"UNAVAILABLE|overloaded|high demand", m, re.I):
        return 503
    if re.search(r"NOT_FOUND|not found", m, re.I):
        return 404
    if re.search(r"timed? ?out|abort", m, re.I):
        return 504
    return 0


async def call_gemini(contents: str, config: types.GenerateContentConfig):
    if client is None:
        raise ProviderError("Gemini not configured")
    last = None
    for model in GEMINI_MODELS:
        for attempt in range(2):
            try:
                return await client.aio.models.generate_content(model=model, contents=contents, config=config)
            except Exception as err:  # noqa: BLE001
                last = err
                s = status_of(err)
                print(f"Gemini {model} failed ({s or 'error'}), attempt {attempt + 1}")
                if s in (503, 500) and attempt == 0:
                    await asyncio.sleep(1.2)
                    continue
                if s in (503, 500, 429, 404, 504):
                    break  # next model
                raise  # bad request, bad key, network
    raise last or ProviderError("No Gemini model answered")


async def call_groq(system: str, prompt: str, json_mode: bool) -> str:
    if not GROQ_KEY:
        raise ProviderError("Groq not configured")
    last = None
    async with httpx.AsyncClient(timeout=TIMEOUT_MS / 1000) as http:
        for model in GROQ_MODELS:
            body = {"model": model, "temperature": 0.3, "max_tokens": 2000,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
            if json_mode:
                body["response_format"] = {"type": "json_object"}
            if "gpt-oss" in model:
                body["reasoning_effort"] = "low"
            for attempt in range(2):
                try:
                    r = await http.post(f"{GROQ_URL}/chat/completions", json=body, headers={"Authorization": f"Bearer {GROQ_KEY}"})
                    if r.status_code >= 400:
                        raise ProviderError(f"Groq {r.status_code}: {r.text[:300]}", r.status_code)
                    content = ((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                    if not content.strip():
                        raise ProviderError("Groq returned an empty answer")
                    return content
                except Exception as err:  # noqa: BLE001
                    last = err
                    s = status_of(err)
                    print(f"Groq {model} failed ({s or 'error'}), attempt {attempt + 1}")
                    # Some models reject optional parameters: retry once without them.
                    if s == 400 and attempt == 0 and ("reasoning_effort" in body or "response_format" in body):
                        body = {k: v for k, v in body.items() if k != "reasoning_effort"}
                        continue
                    break
    raise last or ProviderError("No Groq model answered")


def parse_json(text: str):
    return json.loads(re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", str(text)))


async def structured(system: str, prompt: str, schema: dict, validate):
    """Try Gemini, then Groq. Returns (data, source) or None if both fail."""
    if client is not None:
        try:
            r = await call_gemini(prompt, types.GenerateContentConfig(system_instruction=system, response_mime_type="application/json",
                                                                      response_json_schema=schema, temperature=0.4))
            return validate(parse_json(r.text)), "gemini"
        except Exception as e:  # noqa: BLE001
            print("Gemini gave no usable answer:", str(e)[:200])
    if GROQ_KEY:
        try:
            sys_ = f"{system}\nRespond with only a JSON object, no other text, that matches this JSON Schema:\n{json.dumps(schema)}"
            return validate(parse_json(await call_groq(sys_, prompt, True))), "groq"
        except Exception as e:  # noqa: BLE001
            print("Groq gave no usable answer:", str(e)[:200])
    return None


async def plain_text(system: str, prompt: str):
    """Try Gemini, then Groq. Returns (text, source) or None."""
    if client is not None:
        try:
            r = await call_gemini(prompt, types.GenerateContentConfig(system_instruction=system, temperature=0.3))
            if (r.text or "").strip():
                return r.text, "gemini"
        except Exception as e:  # noqa: BLE001
            print("Gemini gave no usable answer:", str(e)[:200])
    if GROQ_KEY:
        try:
            return await call_groq(system, prompt, False), "groq"
        except Exception as e:  # noqa: BLE001
            print("Groq gave no usable answer:", str(e)[:200])
    return None


async def search_grounded(prompt: str):
    """Gemini with Grounding with Google Search. Returns the raw response."""
    return await call_gemini(prompt, types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())], temperature=0.2))
