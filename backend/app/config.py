from pydantic_settings import BaseSettings
from typing import Literal


class Settings(BaseSettings):
    # "ollama" for local testing, "openai" for demo -- swap with one env var
    model_provider: Literal["ollama", "openai"] = "ollama"

    # Ollama (local)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3-vl:4b-instruct"

    # OpenAI (demo)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # shared
    max_retries: int = 3
    request_timeout_seconds: int = 30

    class Config:
        env_file = ".env"


settings = Settings()