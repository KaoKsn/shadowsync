"""YuNet face detection wrapper."""

from pathlib import Path

import cv2
import numpy as np

from detectors import PIIMatch


MODEL_NAME = "face_detection_yunet_2023mar.onnx"
MODEL_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
    f"{MODEL_NAME}"
)
MODEL_PATH = Path(__file__).resolve().parent / "models" / MODEL_NAME
DETECTION_SCALES = (1.0, 1.5, 2.0)
IOU_MERGE_THRESHOLD = 0.4


def _load_detector(image_size: tuple[int, int]) -> cv2.FaceDetectorYN:
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"YuNet model not found at {MODEL_PATH}. Download {MODEL_NAME} from "
            f"{MODEL_URL} and place it in the models/ folder."
        )
    return cv2.FaceDetectorYN.create(
        str(MODEL_PATH), "", image_size,
        score_threshold=0.8, nms_threshold=0.3, top_k=5000,
    )


def _apply_clahe(image: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    merged = cv2.merge((clahe.apply(l_channel), a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def _iou(box_a: tuple[int, int, int, int], box_b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    inter_x1, inter_y1 = max(ax1, bx1), max(ay1, by1)
    inter_x2, inter_y2 = min(ax2, bx2), min(ay2, by2)
    inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
    if inter_area == 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter_area / float(area_a + area_b - inter_area)


def _merge_boxes(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    merged: list[tuple[int, int, int, int]] = []
    for box in boxes:
        if not any(_iou(box, existing) > IOU_MERGE_THRESHOLD for existing in merged):
            merged.append(box)
    return merged


def _detect_at_scale(image: np.ndarray, scale: float) -> list[tuple[int, int, int, int]]:
    height, width = image.shape[:2]
    scaled = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_LINEAR) if scale != 1.0 else image
    scaled_h, scaled_w = scaled.shape[:2]
    detector = _load_detector((scaled_w, scaled_h))
    _, faces = detector.detect(scaled)
    if faces is None:
        return []
    boxes = []
    for face in faces:
        left = max(0, int(face[0] / scale))
        top = max(0, int(face[1] / scale))
        right = min(width, int((face[0] + face[2]) / scale))
        bottom = min(height, int((face[1] + face[3]) / scale))
        if right > left and bottom > top:
            boxes.append((left, top, right, bottom))
    return boxes


def detect_faces(image_path: Path) -> list[PIIMatch]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Could not read image for face detection: {image_path}")
    enhanced = _apply_clahe(image)
    all_boxes: list[tuple[int, int, int, int]] = []
    for scale in DETECTION_SCALES:
        all_boxes.extend(_detect_at_scale(enhanced, scale))
    return [PIIMatch("FACE", "face", box) for box in _merge_boxes(all_boxes)]
