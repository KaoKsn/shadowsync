import os
import sys
from pathlib import Path

os.environ.setdefault("LLM_PROVIDER", "openai")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ["USE_REDIS"] = "0"
for _role in ("ACTOR_MODEL", "PLANNER_MODEL", "READER_MODEL"):
    os.environ.setdefault(_role, "test-model")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
