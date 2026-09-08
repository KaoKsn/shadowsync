"""Process all supported screenshots in input/ and write redacted copies to output/."""

from pathlib import Path
import shutil

from detectors import build_analyzer, detect_pii, summarize
from face_detector import detect_faces
from ocr import OCRReader
from redact import redact_image


ROOT = Path(__file__).resolve().parent
INPUT_DIR = ROOT / "input"
OUTPUT_DIR = ROOT / "output"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def process_image(image_path: Path, reader: OCRReader, analyzer) -> None:
    output_path = OUTPUT_DIR / image_path.name
    try:
        regions = reader.read(image_path)
        matches = detect_pii(regions, analyzer) if regions else []
        matches.extend(detect_faces(image_path))
        if not matches:
            shutil.copyfile(image_path, output_path)
            message = "OCR found no text" if not regions else "No PII detected"
            print(f"{image_path.name}: {message}; saved unchanged.")
            return
        redact_image(image_path, output_path, regions, matches)
        print(f"{image_path.name}: {summarize(matches)}")
    except Exception as error:
        shutil.copyfile(image_path, output_path)
        print(f"{image_path.name}: processing failed ({error}); saved unchanged.")


def main() -> None:
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    images = sorted(path for path in INPUT_DIR.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    if not images:
        print(f"No supported images found in {INPUT_DIR}.")
        return

    print(f"Processing {len(images)} image(s) locally...")
    reader = OCRReader()
    analyzer = build_analyzer()
    for image_path in images:
        process_image(image_path, reader, analyzer)


if __name__ == "__main__":
    main()
