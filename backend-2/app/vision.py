import base64
import time
from io import BytesIO
from pathlib import Path

from .config import DEBUG_IMAGES, IMAGE_JPEG_QUALITY, IMAGE_MAX_SIDE

_DEBUG_IMAGE_DIR = Path(__file__).resolve().parents[1] / "debug_images"


def compress_image(screenshot_b64: str | None) -> str | None:
    """Downscale + re-encode a (possibly data-URL) screenshot to a small JPEG
    data URL. Returns None when there is nothing usable."""
    if not screenshot_b64:
        return None
    payload = screenshot_b64.partition(",")[2] if screenshot_b64.startswith("data:") else screenshot_b64
    if not payload:
        return None

    try:
        from PIL import Image
    except ImportError:
        return f"data:image/png;base64,{payload}"

    try:
        image = Image.open(BytesIO(base64.b64decode(payload)))
    except Exception:
        return None

    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")

    scale = min(IMAGE_MAX_SIDE / image.width, IMAGE_MAX_SIDE / image.height, 1.0)
    if scale < 1:
        image = image.resize(
            (max(1, int(image.width * scale)), max(1, int(image.height * scale))),
            Image.Resampling.LANCZOS,
        )

    output = BytesIO()
    image.save(output, format="JPEG", quality=IMAGE_JPEG_QUALITY, optimize=True)
    compressed = output.getvalue()

    if DEBUG_IMAGES:
        _DEBUG_IMAGE_DIR.mkdir(exist_ok=True, parents=True)
        (_DEBUG_IMAGE_DIR / f"{int(time.time() * 1000)}.jpg").write_bytes(compressed)

    return f"data:image/jpeg;base64,{base64.b64encode(compressed).decode('ascii')}"
