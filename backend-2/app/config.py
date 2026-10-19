import os
from dotenv import load_dotenv

load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai").lower()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_REPLAN_MODEL = os.getenv("OPENAI_REPLAN_MODEL", "gpt-4.1-mini")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llava")
OLLAMA_REPLAN_MODEL = os.getenv("OLLAMA_REPLAN_MODEL", "llama3.1")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
MAX_JOURNAL_ENTRIES = int(os.getenv("MAX_JOURNAL_ENTRIES", "5"))
MAX_TOTAL_STEPS = int(os.getenv("MAX_TOTAL_STEPS", "25"))

if LLM_PROVIDER == "openai" and not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is required when LLM_PROVIDER=openai")
