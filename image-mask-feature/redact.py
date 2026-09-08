"""Image redaction helpers."""

from pathlib import Path

from PIL import Image, ImageDraw

from detectors import PIIMatch
from ocr import OCRRegion


def redact_image(image_path: Path, output_path: Path, regions: list[OCRRegion], matches: list[PIIMatch]) -> None:
    with Image.open(image_path) as image:
        redacted = image.convert("RGB")
        draw = ImageDraw.Draw(redacted)
        for match in matches:
            draw.rectangle(match.box, fill="black")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        redacted.save(output_path)
