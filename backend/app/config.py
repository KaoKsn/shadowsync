import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_REPLAN_MODEL = os.getenv("OPENAI_REPLAN_MODEL", "gpt-4.1-mini")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
MAX_JOURNAL_ENTRIES = int(os.getenv("MAX_JOURNAL_ENTRIES", "5"))
MAX_TOTAL_STEPS = int(os.getenv("MAX_TOTAL_STEPS", "25"))
