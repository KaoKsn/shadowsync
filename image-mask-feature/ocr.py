"""Offline OCR wrapper for RapidOCR."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


@dataclass(frozen=True)
class OCRRegion:
    text: str
    box: tuple[int, int, int, int]
    confidence: float


class OCRReader:
    def __init__(self) -> None:
        self._engine = RapidOCR()

    def read(self, image_path: Path) -> list[OCRRegion]:
        with Image.open(image_path) as image:
            result, _ = self._engine(np.asarray(image.convert("RGB")))

        regions: list[OCRRegion] = []
        for item in result or []:
            box, text, confidence = item[0], str(item[1]), float(item[2])
            points = [(float(point[0]), float(point[1])) for point in box]
            left = max(0, int(min(point[0] for point in points)))
            top = max(0, int(min(point[1] for point in points)))
            right = int(max(point[0] for point in points))
            bottom = int(max(point[1] for point in points))
            if text.strip() and right > left and bottom > top:
                regions.append(OCRRegion(text=text, box=(left, top, right, bottom), confidence=confidence))
        return regions
