import base64
from io import BytesIO
from pathlib import Path

_DEBUG_IMAGE_DIR = Path(__file__).resolve().parents[3] / "debug_images"
_DEBUG_IMAGE_DIR.mkdir(exist_ok=True, parents=True)


def _prepare_image_url_for_llm(screenshot_b64: str | None) -> str | None:
    """Convert screenshots to compact JPEG, save a debug copy, and return
    a data URL with low detail for the LLM vision request."""
    if not screenshot_b64:
        return None

    if screenshot_b64.startswith("data:"):
        header, _, payload = screenshot_b64.partition(",")
    else:
        header = "data:image/png;base64"
        payload = screenshot_b64

    if not payload:
        return screenshot_b64 if screenshot_b64.startswith("data:") else None

    try:
        from PIL import Image
    except ImportError:
        return screenshot_b64 if screenshot_b64.startswith("data:") else f"data:image/png;base64,{payload}"

    image_bytes = base64.b64decode(payload)
    image = Image.open(BytesIO(image_bytes))

    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")

    max_dimension = 1200
    scale = min(max_dimension / image.width, max_dimension / image.height, 1.0)
    if scale < 1:
        new_size = (max(1, int(image.width * scale)), max(1, int(image.height * scale)))
        image = image.resize(new_size, Image.Resampling.LANCZOS)

    output = BytesIO()
    image.save(output, format="JPEG", quality=72, optimize=True)
    compressed_bytes = output.getvalue()

    debug_path = _DEBUG_IMAGE_DIR / f"compressed_{len(list(_DEBUG_IMAGE_DIR.iterdir())):04d}.jpg"
    debug_path.write_bytes(compressed_bytes)

    return f"data:image/jpeg;base64,{base64.b64encode(compressed_bytes).decode('ascii')}"


def _visible_ids(snapshot) -> set[int]:
    return {el.mark_id for el in snapshot.elements}   # was: el.id


def _get_tool_call_field(tool_call, field_name, default=None):
    if isinstance(tool_call, dict):
        return tool_call.get(field_name, default)
    return getattr(tool_call, field_name, default)


def _get_tool_call_function(tool_call):
    if isinstance(tool_call, dict):
        return tool_call.get("function", {})
    return getattr(tool_call, "function", {})


def _parse_tool_call(tool_call):
    fn = _get_tool_call_function(tool_call)
    if isinstance(fn, dict):
        name = fn.get("name")
        arguments = fn.get("arguments", "{}")
    else:
        name = getattr(fn, "name", None)
        arguments = getattr(fn, "arguments", "{}")

    return {
        "id": _get_tool_call_field(tool_call, "id", "call_0"),
        "name": name,
        "arguments": arguments,
    }