from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from typing import Any, Dict, List
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

app = FastAPI(
    title="FastAPI test endpoints to test extension behaviour", version="1.0.0"
)

# Enable CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Adjust this to restrict origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PayloadItem(BaseModel):
    hint: str = Field(alias="data-hint")
    tag: str
    text: str | None = None
    type: str | None = None


class PagePayload(BaseModel):
    url: str
    elements: List[PayloadItem]
    screenshot: str


@app.get("/", summary="Health Check")
async def index():
    return {"status": "online", "message": "upload files to /upload"}


@app.post(
    "/upload",
    summary="Upload DOM Payload",
    description="Uploads the DOM content and window screenshot(s) for PII masking.",
)
async def upload_dom_payload(payload: PagePayload):
    try:
        print(f"Successfully received {len(payload.elements)} interactive elements.")
        if payload.url:
            print("url: ", payload.url)
        if payload.screenshot:
            print("ScreenShot is present in the payload")
        else:
            print(f"ScreenShot missing from the payload..")
        for element in payload.elements[:3]:  # Print first 3 elements as a sample
            print(element)

        return {
            "status": "success",
            "message": f"Processed {len(payload.elements)} elements",
            "next_action": None,  # TODO Return LLM instructions here later
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return RedirectResponse("/")
