import json
from app.config import settings
from app.state import AgentState, AgentAction


SYSTEM_PROMPT = """You control a browser through a sanitized element map and a redacted screenshot.
You do NOT see raw DOM or real user data -- only the elements listed below.

Respond with ONLY a JSON object, no markdown, no preamble:
{
    "type": "CLICK" | "TYPE" | "SCROLL" | "DONE" | "USER",
    "data_hint": "<data_hint from the element list, or null>",
    "element_id": "<element_id from the element list, or null>",
    "text": "<text to type, or an instruction for the user, or null>",
    "reasoning": "<one short sentence>"
}

Rules:
- Use "data_hint" values EXACTLY as given in the element list. Never invent one.
- Never choose an element where "disabled" is true.
- Use "DONE" only when the task goal is fully satisfied.
- Use "USER" when the task requires something you cannot or should not do yourself --
    e.g. a captcha, OTP/2FA code, payment details, login credentials, or any action needing
    human judgement or sensitive input. Put a clear, specific instruction in "text" telling
    the user exactly what to do (e.g. "Enter the 6-digit OTP sent to your phone and click Verify").
- One action per response.
"""


def _format_element(el: dict) -> str:
    parts = [f'data_hint={el["data_hint"]}', f'tag={el["tag"]}']

    if el.get("element_id"):
        parts.append(f'element_id={el["element_id"]}')
    if el.get("role"):
        parts.append(f'role={el["role"]}')
    if el.get("type"):
        parts.append(f'type={el["type"]}')
    if el.get("value"):
        parts.append(f'value={el["value"]}')
    if el.get("aria_label"):
        parts.append(f'aria_label={el["aria_label"]}')
    if el.get("placeholder"):
        parts.append(f'placeholder={el["placeholder"]}')
    if el.get("name"):
        parts.append(f'name={el["name"]}')
    if el.get("href"):
        parts.append(f'href={el["href"]}')
    if el.get("disabled"):
        parts.append("disabled=true")
    if el.get("checked") is not None:
        parts.append(f'checked={el["checked"]}')

    return "- " + " ".join(parts)


def _build_user_prompt(state: AgentState) -> str:
    elements_text = "\n".join(_format_element(el) for el in state["sanitized_dom"])

    history_text = "\n".join(
        f'{i+1}. {a["type"]} data_hint={a.get("data_hint")} text={a.get("text")}'
        for i, a in enumerate(state["action_history"])
    ) or "(none yet)"

    return f"""Task goal: {state['task_goal']}

Actions taken so far:
{history_text}

Current visible elements:
{elements_text}

What is the next action?"""


def _parse_response(raw_text: str) -> AgentAction:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json\n", "", 1)

    data = json.loads(cleaned)

    return AgentAction(
        type=data["type"],
        data_hint=data.get("data_hint"),
        element_id=data.get("element_id"),
        text=data.get("text"),
        reasoning=data.get("reasoning"),
    )


def _call_ollama(state: AgentState) -> AgentAction:
    import ollama

    response = ollama.chat(
        model=settings.ollama_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _build_user_prompt(state),
                "images": [state["sanitized_screenshot_b64"]],
            },
        ],
        options={"temperature": 0.1},
    )
    return _parse_response(response["message"]["content"])


def _call_openai(state: AgentState) -> AgentAction:
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)

    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _build_user_prompt(state)},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{state['sanitized_screenshot_b64']}"
                        },
                    },
                ],
            },
        ],
        temperature=0.1,
    )
    return _parse_response(response.choices[0].message.content)


def generate_action(state: AgentState) -> AgentAction:
    """Single entry point used by the reason_plan node.
    Swap models by changing MODEL_PROVIDER in .env -- nothing else changes."""
    if settings.model_provider == "ollama":
        return _call_ollama(state)
    elif settings.model_provider == "openai":
        return _call_openai(state)
    raise ValueError(f"Unknown model_provider: {settings.model_provider}")