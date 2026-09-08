# ShadowSync Image Masker

This feature is a local PII-redaction prototype for ShadowSync. It uses RapidOCR, Microsoft Presidio, spaCy, and OpenCV YuNet locally to detect sensitive text and faces in screenshots, then covers detected regions with solid black rectangles.

## Features

- Offline OCR with RapidOCR
- Local PII detection with Presidio and spaCy
- Custom detection for Indian PAN, Aadhaar, API keys/tokens, bank accounts, passwords, usernames, student IDs, dates of birth, and blood groups
- Local face detection with OpenCV YuNet
- Same-filename redacted output
- No Google Vision, OpenAI, AWS, or other cloud OCR/NLP API calls during processing

## Requirements

- Python 3.11 or newer
- A terminal opened in this folder
- Internet access only for the first-time package/model installation

## Setup

From this folder, create and activate a virtual environment.

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### Windows Command Prompt

```text
python -m venv .venv
.venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### macOS or Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

The requirements file installs the pinned `en_core_web_sm` spaCy model. If the model wheel cannot be retrieved through the configured package source, run:

```text
python -m spacy download en_core_web_sm
```

Download the YuNet face model into `models/`:

```powershell
New-Item -ItemType Directory -Force models
Invoke-WebRequest `
  -Uri "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" `
  -OutFile "models/face_detection_yunet_2023mar.onnx"
```

The model is intentionally ignored by Git. Each contributor downloads it locally.

## Usage

1. Place screenshots in `input/`.
2. Run the program from this folder:

```text
python main.py
```

3. Find redacted images in `output/` with the same filenames.

Supported formats: `.png`, `.jpg`, `.jpeg`, `.bmp`, `.tif`, `.tiff`, and `.webp`.

Example:

```text
input/student-card.png -> output/student-card.png
```

If OCR finds no text, no PII is detected, or processing fails, the original image is still saved to `output/` and a message is printed.

## Folder Structure

```text
image-mask-feature/
|-- input/              # Input screenshots, ignored by Git
|-- output/             # Generated redacted images, ignored by Git
|-- models/             # Local YuNet model, ignored by Git
|-- test-images/        # Optional local tests, ignored by Git
|-- main.py             # CLI entry point
|-- ocr.py              # RapidOCR wrapper
|-- detectors.py        # Presidio and custom PII detection
|-- face_detector.py   # YuNet face detection
|-- redact.py           # Black rectangle drawing
|-- requirements.txt
|-- .gitignore
`-- README.md
```

## Limitations

- Context-sensitive name detection can produce false positives or false negatives. For example, `John` the person may be confused with `John's Pizza` the business name.
- When OCR returns a label and value in one combined box, partial masking uses estimated character positions and may not be exact.
- The prototype detects faces with YuNet, but other non-text visual content such as logos is not automatically classified as PII.
- The console summary counts detected redaction boxes, so one real value split into multiple OCR boxes may appear more than once in the summary.

## Collaboration Notes

Do not commit personal screenshots, generated outputs, virtual environments, Python caches, or downloaded model files. Check the feature folder before committing:

```powershell
git status
```
