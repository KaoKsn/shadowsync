import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, "1" if default else "0").strip().lower() in ("1", "true", "yes", "on")


# --- LLM -------------------------------------------------------------------
# One OpenAI-compatible client serves both providers. For Ollama, LLM_BASE_URL
# defaults to its OpenAI-compatible /v1 endpoint.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai").lower()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

if LLM_PROVIDER == "ollama":
    LLM_BASE_URL = os.getenv("LLM_BASE_URL", f"{OLLAMA_BASE_URL.rstrip('/')}/v1")
else:
    LLM_BASE_URL = os.getenv("LLM_BASE_URL") or None


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set in .env (see .env.example)")
    return value


# Models come only from .env -- no hardcoded defaults.
ACTOR_MODEL = _required("ACTOR_MODEL")
PLANNER_MODEL = _required("PLANNER_MODEL")
READER_MODEL = _required("READER_MODEL")

ACTOR_MAX_TOKENS = _int("ACTOR_MAX_TOKENS", 200)
PLANNER_MAX_TOKENS = _int("PLANNER_MAX_TOKENS", 350)
READER_MAX_TOKENS = _int("READER_MAX_TOKENS", 250)

# --- Budgets ---------------------------------------------------------------
MAX_TOTAL_STEPS = _int("MAX_TOTAL_STEPS", 30)
MAX_SCREENSHOTS = _int("MAX_SCREENSHOTS", 6)
MAX_REPLANS = _int("MAX_REPLANS", 2)
MAX_ELEMENTS = _int("MAX_ELEMENTS", 80)
MAX_LABEL_CHARS = _int("MAX_LABEL_CHARS", 60)
MAX_JOURNAL_IN_PROMPT = _int("MAX_JOURNAL_IN_PROMPT", 5)
MAX_JOURNAL_STORED = _int("MAX_JOURNAL_STORED", 12)
MAX_MEMORY_NOTES = _int("MAX_MEMORY_NOTES", 10)
MAX_PAGE_TEXT_CHARS = _int("MAX_PAGE_TEXT_CHARS", 6000)

# --- Vision ----------------------------------------------------------------
IMAGE_MAX_SIDE = _int("IMAGE_MAX_SIDE", 768)
IMAGE_JPEG_QUALITY = _int("IMAGE_JPEG_QUALITY", 55)
IMAGE_DETAIL = os.getenv("IMAGE_DETAIL", "low")
DEBUG_IMAGES = _bool("DEBUG_IMAGES", False)

# --- Storage ---------------------------------------------------------------
USE_REDIS = _bool("USE_REDIS", True)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
SESSION_TTL_MINUTES = _int("SESSION_TTL_MINUTES", 30)

if LLM_PROVIDER == "openai" and not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
