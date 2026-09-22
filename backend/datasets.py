"""CSV datasets exposed as prediction tasks: pick a column, Laya predicts it from the rest of the row."""
import csv
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

DATA_DIR = Path(__file__).parent / "data"

DATASETS: Dict[str, Dict[str, Any]] = {
    "steak-risk": {
        "name": "Steak & risk survey (FiveThirtyEight)",
        "file": "steak-risk-survey.csv",
        "subject": "survey respondent",
        # Columns are keyed by a short id; the second CSV row is a "Response" filler row.
        "skip_rows": 1,
        "columns": {
            "Consider the following": "lottery",
            "Do you ever smoke": "smokes",
            "Do you ever drink": "drinks",
            "Do you ever gamble": "gambles",
            "Have you ever been skydiving": "skydived",
            "Do you ever drive above": "speeds",
            "Have you ever cheated": "cheated",
            "Do you eat steak": "eats_steak",
            "How do you like your steak": "steak_doneness",
            "Gender": "gender",
            "Age": "age",
            "Household Income": "income",
            "Education": "education",
            "Location": "region",
        },
        "ordinal": {
            "steak_doneness": ["Rare", "Medium rare", "Medium", "Medium Well", "Well"],
            "age": ["18-29", "30-44", "45-60", "> 60"],
            "income": ["$0 - $24,999", "$25,000 - $49,999", "$50,000 - $99,999", "$100,000 - $149,999", "$150,000+"],
            "education": [
                "Less than high school degree", "High school degree",
                "Some college or Associate degree", "Bachelor degree", "Graduate degree",
            ],
        },
        "default_target": "steak_doneness",
    },
}


def _clean(text: str) -> str:
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def _column_id(spec: Dict[str, Any], header: str) -> str:
    for prefix, cid in spec["columns"].items():
        if header.startswith(prefix):
            return cid
    return re.sub(r"[^a-z0-9]+", "_", header.lower()).strip("_")[:40]


@lru_cache(maxsize=None)
def load(dataset_id: str) -> Dict[str, Any]:
    spec = DATASETS[dataset_id]
    with open(DATA_DIR / spec["file"], encoding="utf-8-sig", newline="") as f:
        reader = list(csv.reader(f))
    header, body = reader[0], reader[1 + spec.get("skip_rows", 0):]

    id_col, cols = header[0], header[1:]
    columns = []
    for i, h in enumerate(cols, start=1):
        cid = _column_id(spec, h)
        counts = Counter(r[i].strip() for r in body if i < len(r) and r[i].strip())
        order = spec.get("ordinal", {}).get(cid) or [v for v, _ in counts.most_common()]
        columns.append({
            "id": cid,
            "question": _clean(h),
            "ordinal": cid in spec.get("ordinal", {}),
            "options": [{"value": v, "count": counts.get(v, 0)} for v in order],
        })

    rows: List[Dict[str, Any]] = []
    for r in body:
        answers = {c["id"]: r[i].strip() for i, c in enumerate(columns, start=1) if i < len(r) and r[i].strip()}
        if answers:
            rows.append({"id": r[0] or str(len(rows)), "answers": answers})

    return {
        "id": dataset_id,
        "name": spec["name"],
        "subject": spec["subject"],
        "id_column": id_col,
        "default_target": spec.get("default_target"),
        "columns": columns,
        "rows": rows,
    }


def summaries() -> List[Dict[str, Any]]:
    out = []
    for did in DATASETS:
        d = load(did)
        out.append({"id": did, "name": d["name"], "rows": len(d["rows"]), "columns": len(d["columns"])})
    return out
