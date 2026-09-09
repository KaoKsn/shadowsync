from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from typing import Any, Dict, List
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

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
    hint: str
    tag: str
    text: str | None = None
    type: str | None = None


class PagePayload(BaseModel):
    url: str
    elements: List[PayloadItem]
    screenshot: str | None = None  # img as base64 string.


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
            save_screenshot(payload.screenshot)
        else:
            print(f"ScreenShot missing from the payload..")
        for element in payload.elements[:10]:  # Print first 3 elements as a sample
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


import base64
from pathlib import Path


def save_screenshot(screenshot: str, filename: str = "screenshot.png") -> None:
    if not screenshot:
        return

    # Handle data URLs such as:
    # data:image/png;base64,iVBORw0KGgo...
    if "," in screenshot:
        _, encoded_data = screenshot.split(",", 1)
    else:
        encoded_data = screenshot

    image_data = base64.b64decode(encoded_data)

    Path(filename).write_bytes(image_data)

    print(f"Screenshot saved to {filename}")
