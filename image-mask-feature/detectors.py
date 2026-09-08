"""Presidio configuration and local PII detection."""

from collections import Counter
from dataclasses import dataclass
import re

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider

from ocr import OCRRegion


@dataclass(frozen=True)
class PIIMatch:
    entity: str
    text: str
    box: tuple[int, int, int, int]


ENTITY_NAMES = {
    "EMAIL_ADDRESS": "email",
    "PHONE_NUMBER": "phone",
    "CREDIT_CARD": "credit card",
    "PERSON": "name",
    "LOCATION": "location",
    "PAN": "PAN",
    "AADHAAR": "Aadhaar",
    "API_KEY": "API key/token",
    "BANK_ACCOUNT": "bank account",
    "PASSWORD": "password",
    "USERNAME": "username",
    "STUDENT_ID": "student ID",
    "DATE_OF_BIRTH": "date of birth",
    "BLOOD_GROUP": "blood group",
    "FACE": "face",
}

UI_DENYLIST = {
    "verified", "complete", "pending", "active", "inactive", "postmatric",
    "prematric", "step", "profile", "contact", "gender", "male", "female",
    "program", "state", "status", "submit", "cancel", "save", "edit",
    "important", "instructions", "students", "applicants", "read",
    "manual", "carefully", "before", "applying",
}

STOPWORDS = {
    "to", "of", "and", "for", "in", "is", "are", "the", "with", "from",
    "on", "at", "by", "or", "a", "an", "no", "not", "if", "may", "must",
}

STACKED_LABELS = {
    "full name", "ssp id", "email address", "mobile number", "state",
    "gender", "program", "date of birth", "dob", "blood group",
    "student id", "usn", "roll number", "registration number",
    "parent name", "address",
}


def _recognizer(entity: str, regex: str, score: float) -> PatternRecognizer:
    return PatternRecognizer(
        supported_entity=entity,
        patterns=[Pattern(name=entity.lower(), regex=regex, score=score)],
    )


def build_analyzer() -> AnalyzerEngine:
    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
    )
    analyzer = AnalyzerEngine(nlp_engine=provider.create_engine(), supported_languages=["en"])
    custom = [
        _recognizer("PAN", r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", 0.95),
        _recognizer("AADHAAR", r"\b\d{4}\s?\d{4}\s?\d{4}\b", 0.9),
        _recognizer(
            "API_KEY",
            r"\b(?:sk-|ghp_|AKIA)[A-Za-z0-9_-]{16,}\b|\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b",
            0.8,
        ),
        _recognizer("BANK_ACCOUNT", r"\b\d{9,18}\b", 0.3),
        _recognizer("USERNAME", r"(?<!\w)@[A-Za-z0-9_]{2,32}\b", 0.85),
        _recognizer("PASSWORD", r"(?<!\S)[.*•]{4,}(?!\S)", 0.9),
        _recognizer("STUDENT_ID", r"\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b", 0.65),
        _recognizer("DATE_OF_BIRTH", r"\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b", 0.9),
        _recognizer("BLOOD_GROUP", r"\b(?:A|B|AB|O)\s?[+-](?:ve|positive|negative)?\b", 0.8),
    ]
    for recognizer in custom:
        analyzer.registry.add_recognizer(recognizer)
    return analyzer


def _line_groups(regions: list[OCRRegion]) -> list[list[OCRRegion]]:
    groups: list[list[OCRRegion]] = []
    for region in sorted(regions, key=lambda item: (item.box[1], item.box[0])):
        top, bottom = region.box[1], region.box[3]
        matching_group = next(
            (
                group
                for group in groups
                if min(bottom, max(item.box[3] for item in group))
                - max(top, min(item.box[1] for item in group))
                >= 0.35 * min(bottom - top, max(item.box[3] for item in group) - min(item.box[1] for item in group))
            ),
            None,
        )
        if matching_group is None:
            groups.append([region])
        else:
            matching_group.append(region)
    return [sorted(group, key=lambda item: item.box[0]) for group in groups]


def _is_denied(text: str) -> bool:
    return text.strip().lower() in UI_DENYLIST


def _looks_like_name(line_text: str) -> bool:
    words = re.findall(r"[A-Za-z]+", line_text)
    if not 2 <= len(words) <= 4 or not all(word.isalpha() and len(word) >= 2 for word in words):
        return False
    if any(word.lower() in STOPWORDS for word in words):
        return False
    if not all(word[0].isupper() for word in words):
        return False
    excluded_terms = (
        "institute", "technology", "department", "programme", "engineering",
        "autonomous", "affiliated", "student", "card",
    )
    text_lower = line_text.lower()
    return not any(term in text_lower for term in excluded_terms) and not _is_denied(line_text)


def _line_is_sensitive(line_text: str) -> bool:
    text = line_text.lower()
    if re.search(r"\b(?:usn|student id|roll|registration|reg\.?\s*no)\b", text):
        return True
    if re.search(r"\b(?:dob|date of birth|parent name|address|blood)\b", text):
        return True
    if re.search(r"\b(?:password|pwd|username|user:)\b", text):
        return True
    return _looks_like_name(line_text)


def _sensitive_ranges(line_text: str, results: list[RecognizerResult]) -> list[tuple[int, int]]:
    filtered_results = []
    for result in results:
        matched_text = line_text[result.start:result.end]
        if _is_denied(matched_text):
            continue
        if result.entity_type == "PERSON" and len(matched_text.split()) < 2:
            continue
        filtered_results.append(result)

    ranges = [(result.start, result.end) for result in filtered_results]
    label_pattern = re.compile(
        r"\b(?:usn|ssp\s+id|student\s+id|roll|registration|reg\.?\s*no|dob|date\s+of\s+birth|"
        r"blood|password|pwd|username|user|email|phone)\b\s*:?",
        re.IGNORECASE,
    )
    labels = list(label_pattern.finditer(line_text))
    for index, label in enumerate(labels):
        end = labels[index + 1].start() if index + 1 < len(labels) else len(line_text)
        ranges.append((label.end(), end))
    if _line_is_sensitive(line_text) and not labels and not ranges:
        ranges.append((0, len(line_text)))
    return ranges


def _horizontally_overlaps(a: OCRRegion, b: OCRRegion) -> bool:
    a_left, a_right = a.box[0], a.box[2]
    b_left, b_right = b.box[0], b.box[2]
    overlap = min(a_right, b_right) - max(a_left, b_left)
    min_width = min(a_right - a_left, b_right - b_left)
    return min_width > 0 and overlap / min_width >= 0.2


def _stacked_label_matches(groups: list[list[OCRRegion]]) -> list[PIIMatch]:
    matches: list[PIIMatch] = []
    for i, group in enumerate(groups[:-1]):
        text = re.sub(r"[^a-z0-9]+", " ", " ".join(region.text for region in group).lower()).strip()
        if text not in STACKED_LABELS:
            continue
        label_top = min(region.box[1] for region in group)
        label_bottom = max(region.box[3] for region in group)
        label_height = label_bottom - label_top
        following_groups = groups[i + 1:]
        next_group = min(
            (candidate for candidate in following_groups if min(region.box[1] for region in candidate) > label_bottom),
            key=lambda candidate: min(region.box[1] for region in candidate),
            default=None,
        )
        if next_group is None:
            continue
        next_top = min(region.box[1] for region in next_group)
        next_bottom = max(region.box[3] for region in next_group)
        value_height = next_bottom - next_top
        if next_top - label_bottom > 5.0 * max(label_height, value_height):
            continue
        matches.extend(PIIMatch("FORM_VALUE", value_region.text, value_region.box) for value_region in next_group)
    return matches


def _direct_stacked_label_matches(regions: list[OCRRegion]) -> list[PIIMatch]:
    labels = {
        "full name", "ssp id", "email address", "mobile number", "date of birth",
        "dob", "blood group", "student id", "usn", "parent name", "address",
    }
    matches: list[PIIMatch] = []
    for label in regions:
        label_text = re.sub(r"[^a-z0-9]+", " ", label.text.lower()).strip()
        if label_text not in labels:
            continue
        candidates = [
            region for region in regions
            if region.box[1] > label.box[3]
            and region.box[1] - label.box[3] <= 100
            and _horizontally_overlaps(label, region)
        ]
        if candidates:
            value = min(candidates, key=lambda region: region.box[1])
            matches.append(PIIMatch("FORM_VALUE", value.text, value.box))
    return matches


def _header_name_matches(groups: list[list[OCRRegion]]) -> list[PIIMatch]:
    matches: list[PIIMatch] = []
    for group, next_group in zip(groups, groups[1:]):
        first = " ".join(region.text for region in group).strip()
        second = " ".join(region.text for region in next_group).strip()
        first_top = min(region.box[1] for region in group)
        second_top = min(region.box[1] for region in next_group)
        if first_top < 150 and second_top - max(region.box[3] for region in group) < 20 and re.fullmatch(r"[A-Za-z]{3,}", first) and re.fullmatch(r"[A-Za-z]{3,}", second):
            matches.extend(PIIMatch("PERSON", region.text, region.box) for region in group + next_group)
            break
    return matches


def _partial_box(region: OCRRegion, start: int, end: int, line_offset: int) -> tuple[int, int, int, int]:
    text_length = max(1, len(region.text))
    left, top, right, bottom = region.box
    value_left = left + int((start - line_offset) / text_length * (right - left))
    value_right = left + int((end - line_offset) / text_length * (right - left))
    return max(left, value_left), top, min(right, value_right), bottom


def detect_pii(regions: list[OCRRegion], analyzer: AnalyzerEngine | None = None) -> list[PIIMatch]:
    analyzer = analyzer or build_analyzer()
    entities = list(ENTITY_NAMES)
    matches: list[PIIMatch] = []
    groups = _line_groups(regions)

    for line in groups:
        line_text = " ".join(region.text for region in line)
        results = analyzer.analyze(text=line_text, language="en", entities=entities)
        ranges = _sensitive_ranges(line_text, results)
        if ranges:
            entity = results[0].entity_type if results else "PERSON"
            offset = 0
            for region in line:
                start = offset
                end = start + len(region.text)
                for range_start, range_end in ranges:
                    overlap_start = max(start, range_start)
                    overlap_end = min(end, range_end)
                    if overlap_start < overlap_end:
                        box = _partial_box(region, overlap_start, overlap_end, start)
                        matches.append(PIIMatch(entity, region.text, box))
                        break
                offset = end + 1

    matches.extend(_stacked_label_matches(groups))
    matches.extend(_direct_stacked_label_matches(regions))
    matches.extend(_header_name_matches(groups))
    return matches


def summarize(matches: list[PIIMatch]) -> str:
    counts = Counter(ENTITY_NAMES.get(match.entity, match.entity) for match in matches)
    if not counts:
        return "No PII detected."
    details = ", ".join(f"{count} {name}" for name, count in sorted(counts.items()))
    return f"{len(matches)} PII item(s) found: {details} redacted."
