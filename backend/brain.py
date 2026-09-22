"""Glass-box tracing of a Laya forward pass.

Mirrors `laya.Agent.system_one` step for step, but keeps every intermediate value
(token sequence, raw logits, temperature bucket, pre/post calibration probabilities,
act-head features) and adds two diagnostics the stock runtime does not offer:
leave-one-out attribution over the state and an option-order sensitivity check.
"""
import math
import re
import time
from typing import Any, Dict, List, Optional, Union

import numpy as np
import torch
from laya.common import (
    QTYPES,
    build_sequence,
    collate_items,
    confidence_from_probs,
    render_options,
    serialize_state,
    temp_bucket,
)

State = Union[str, dict, list]

BATCH_SIZE = 16
MAX_PIECES = 40


def _softmax(z: np.ndarray) -> np.ndarray:
    e = np.exp(z - z.max())
    return e / e.sum()


def _entropy_norm(p: np.ndarray, k: int) -> float:
    ent = -(p * np.log(np.clip(p, 1e-9, 1.0))).sum()
    return float(ent / math.log(max(k, 2)))


def _forward(agent, items: List[Dict]) -> tuple[np.ndarray, np.ndarray]:
    """Run items through the model in chunks; returns (logits [n, kmax], act_probs [n, n_act])."""
    kmax = max(len(it["markers"]) for it in items)
    all_logits, all_act = [], []
    use_amp = agent.device.type == "cuda"
    with torch.no_grad():
        for i in range(0, len(items), BATCH_SIZE):
            b = collate_items([items[i : i + BATCH_SIZE]], agent.tok.pad_token_id)
            with torch.autocast(device_type=agent.device.type, dtype=agent.dtype, enabled=use_amp):
                logits, act = agent.model(
                    b["input_ids"].to(agent.device),
                    b["attention_mask"].to(agent.device),
                    b["marker_pos"].to(agent.device),
                    b["marker_mask"].to(agent.device),
                    b["qtype"].to(agent.device),
                )
            lg = logits.float().cpu().numpy()
            if lg.shape[1] < kmax:
                lg = np.pad(lg, ((0, 0), (0, kmax - lg.shape[1])), constant_values=-1e4)
            all_logits.append(lg)
            all_act.append(torch.softmax(act.float(), -1).cpu().numpy())
    return np.concatenate(all_logits), np.concatenate(all_act)


def _item(agent, state: State, q: Dict, option_order: Optional[List[int]] = None) -> Dict:
    seq, markers = build_sequence(
        agent.tok, state, q,
        agent.cfg.get("max_len", 512), agent.cfg.get("head_max_len", 192),
        option_order=option_order,
    )
    return {"ids": seq, "markers": markers, "qtype": QTYPES[q["t"]]}


def _temperature(agent, qt: int, k: int) -> Dict[str, Any]:
    bucket = temp_bucket(qt, k)
    in_bucket = bucket in agent.temperature_by_options
    applied = agent.temperature_by_options.get(bucket, agent.temperature[qt])
    shipped = agent.temperature_by_options_raw.get(bucket, agent.temperature_raw[qt])
    return {
        "bucket": bucket,
        "source": "options bucket" if in_bucket else "question-type default",
        "shipped": round(float(shipped), 4),
        "applied": round(float(applied), 4),
        "clamped": round(float(shipped), 6) != round(float(applied), 6),
    }


def _labels(q: Dict) -> List[str]:
    if q["t"] == "choice":
        return list(q["crit"].keys())
    if q["t"] == "score":
        return [str(i) for i in range(len(q["crit"]))]
    return ["false", "true"]


def _answer(q: Dict, p: np.ndarray, act_p: float) -> Dict[str, Any]:
    """Identical output shape to `laya.Agent.system_one`."""
    k = len(p)
    conf = round(confidence_from_probs(p, k), 4)
    ext = {"act_probability": round(act_p, 4)}
    if q["t"] == "choice":
        keys = list(q["crit"].keys())
        return {
            "type": "choice",
            "choice": keys[int(p.argmax())],
            "probabilities": {kk: round(float(v), 4) for kk, v in zip(keys, p)},
            "confidence": conf,
            "action": ext,
        }
    if q["t"] == "score":
        return {
            "type": "score",
            "score": round(float((np.arange(k) * p).sum()), 4),
            "legend": {str(i): c for i, c in enumerate(q["crit"])},
            "probabilities": {str(i): round(float(v), 4) for i, v in enumerate(p)},
            "confidence": conf,
            "action": ext,
        }
    return {
        "type": "noul",
        "noul": round(float(p[1]), 4),
        "confidence": round(max(float(p[1]), 1.0 - float(p[1])), 4),
        "action": ext,
    }


def _tokens(agent, seq: List[int], markers: List[int]) -> Dict[str, Any]:
    """Label every token of the model input with the segment it belongs to."""
    sep = agent.tok.sep_token_id
    s1 = seq.index(sep, 1)
    s2 = seq.index(sep, markers[-1]) if markers else s1
    marker_set = {m: i for i, m in enumerate(markers)}
    out, opt = [], -1
    for pos, tid in enumerate(seq):
        if pos == 0:
            role = "cls"
        elif pos < s1:
            role = "instruction"
        elif pos in (s1, s2) or pos == len(seq) - 1:
            role = "sep"
        elif pos in marker_set:
            opt = marker_set[pos]
            role = "marker"
        elif pos < s2:
            role = "option"
        else:
            role = "state"
        out.append({"t": agent.tok.decode([tid]), "role": role, "opt": opt if role in ("marker", "option") else None})
    return {"tokens": out, "state_start": s2 + 1, "n_state_tokens": len(seq) - s2 - 2}


def _pieces(state: State) -> tuple[List[Dict[str, Any]], Optional[List[str]]]:
    """Split the state into removable units: JSON fields, list turns, or sentences/words of text."""
    if isinstance(state, dict):
        return [{"label": str(k), "text": serialize_state(v), "key": k} for k, v in list(state.items())[:MAX_PIECES]], None
    if isinstance(state, list):
        return [{"label": f"turn {i}", "text": serialize_state(v), "key": i} for i, v in enumerate(state[:MAX_PIECES])], None
    parts = [s for s in re.split(r"(?<=[.!?])\s+|\n+", state) if s.strip()]
    if len(parts) < 2:
        parts = state.split()
    parts = parts[:MAX_PIECES]
    return [{"label": p[:60], "text": p, "key": i} for i, p in enumerate(parts)], parts


def _without(state: State, piece: Dict, all_text_parts: Optional[List[str]]) -> State:
    if isinstance(state, dict):
        return {k: v for k, v in state.items() if k != piece["key"]}
    if isinstance(state, list):
        return [v for i, v in enumerate(state) if i != piece["key"]]
    return " ".join(p for i, p in enumerate(all_text_parts) if i != piece["key"])


def trace(agent, state: State, questions: Dict[str, Dict[str, Any]], attribution: bool = True,
          order_check: bool = True) -> Dict[str, Any]:
    ids = list(questions.keys())
    qs = [agent._to_internal(questions[qid]) for qid in ids]

    base_items = [_item(agent, state, q) for q in qs]
    t0 = time.perf_counter()
    logits, act = _forward(agent, base_items)
    forward_ms = (time.perf_counter() - t0) * 1000

    full_state_tokens = len(agent.tok(serialize_state(state), add_special_tokens=False)["input_ids"])

    results = {}
    base_probs = []
    for r, (qid, q) in enumerate(zip(ids, qs)):
        it = base_items[r]
        k = len(it["markers"])
        qt = QTYPES[q["t"]]
        raw = logits[r, :k].astype(float)
        temp = _temperature(agent, qt, k)
        p_uncal = _softmax(raw)
        p = _softmax(raw / temp["applied"])
        base_probs.append(p)
        top2 = np.sort(p_uncal)[::-1][:2] if k >= 2 else np.array([p_uncal[0], 0.0])
        tok_info = _tokens(agent, it["ids"], it["markers"])
        results[qid] = {
            "question": questions[qid],
            "labels": _labels(q),
            "options_rendered": render_options(q),
            "answer": _answer(q, p, float(act[r, 0])),
            "logits": [round(float(x), 4) for x in raw],
            "probs_uncalibrated": [round(float(x), 4) for x in p_uncal],
            "probs": [round(float(x), 4) for x in p],
            "temperature": temp,
            "confidence": {
                "value": round(confidence_from_probs(p, k), 4),
                "entropy_norm": round(_entropy_norm(p, k), 4),
            },
            "act_gate": {
                "act": round(float(act[r, 0]), 4),
                "escalate": round(float(act[r, 1]), 4) if act.shape[1] > 1 else None,
                "features": {
                    "top1": round(float(top2[0]), 4),
                    "margin": round(float(top2[0] - top2[1]), 4),
                    "entropy_norm": round(_entropy_norm(p_uncal, k), 4),
                    "k_scaled": round(k / 255.0, 4),
                },
            },
            "sequence": {
                **tok_info,
                "length": len(it["ids"]),
                "markers": it["markers"],
                "state_tokens_total": full_state_tokens,
                "state_tokens_truncated": max(0, full_state_tokens - tok_info["n_state_tokens"]),
            },
        }

    extra_items, extra_meta = [], []

    if order_check:
        for r, q in enumerate(qs):
            k = len(base_items[r]["markers"])
            if q["t"] != "noul" and k >= 2:
                order = list(range(k))[::-1]
                extra_items.append(_item(agent, state, q, option_order=order))
                extra_meta.append(("order", r, order))

    text_parts = None
    pieces: List[Dict[str, Any]] = []
    if attribution:
        pieces, text_parts = _pieces(state)
        if len(pieces) < 2:
            pieces = []
        for pi, piece in enumerate(pieces):
            reduced = _without(state, piece, text_parts)
            for r, q in enumerate(qs):
                extra_items.append(_item(agent, reduced, q))
                extra_meta.append(("piece", r, pi))

    t1 = time.perf_counter()
    if extra_items:
        x_logits, _ = _forward(agent, extra_items)
    diag_ms = (time.perf_counter() - t1) * 1000

    attributions: Dict[str, List[Dict[str, Any]]] = {qid: [] for qid in ids}
    for j, meta in enumerate(extra_meta):
        kind, r = meta[0], meta[1]
        qid, q = ids[r], qs[r]
        k = len(base_items[r]["markers"])
        temp = results[qid]["temperature"]["applied"]
        p_base = base_probs[r]
        top = int(p_base.argmax())
        if kind == "order":
            order = meta[2]
            p_rev = _softmax(x_logits[j, :k].astype(float) / temp)
            p_mapped = np.zeros(k)
            for slot, orig in enumerate(order):
                p_mapped[orig] = p_rev[slot]
            results[qid]["order_check"] = {
                "probs_reversed_order": [round(float(x), 4) for x in p_mapped],
                "answer_changed": int(p_mapped.argmax()) != top,
                "tvd": round(float(0.5 * np.abs(p_mapped - p_base).sum()), 4),
            }
        else:
            piece = pieces[meta[2]]
            p_wo = _softmax(x_logits[j, :k].astype(float) / temp)
            entry = {
                "label": piece["label"],
                "text": piece["text"][:200],
                "support": round(float(p_base[top] - p_wo[top]), 4),
                "tvd": round(float(0.5 * np.abs(p_wo - p_base).sum()), 4),
                "top_without": int(p_wo.argmax()),
                "flipped": int(p_wo.argmax()) != top,
                "probs_without": [round(float(x), 4) for x in p_wo],
            }
            if q["t"] == "score":
                idx = np.arange(k)
                entry["score_shift"] = round(float((idx * p_wo).sum() - (idx * p_base).sum()), 4)
            attributions[qid].append(entry)

    for qid in ids:
        results[qid]["attribution"] = sorted(attributions[qid], key=lambda e: -e["tvd"]) if attribution else None

    return {
        "model": "laya-rl-agent",
        "state_kind": type(state).__name__,
        "state_serialized": serialize_state(state),
        "questions": results,
        "order": ids,
        "timing_ms": {"forward": round(forward_ms, 1), "diagnostics": round(diag_ms, 1)},
        "passes": {"base": len(base_items), "diagnostic": len(extra_items)},
        "usage": {"input_tokens": int(sum(len(it["ids"]) for it in base_items)), "output_tokens": 0},
    }


def batch(agent, states: List[State], question: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate one question over many states; returns raw logits so temperature can be re-fitted client-side."""
    q = agent._to_internal(question)
    items = [_item(agent, s, q) for s in states]
    t0 = time.perf_counter()
    logits, act = _forward(agent, items)
    ms = (time.perf_counter() - t0) * 1000
    k = len(items[0]["markers"])
    temp = _temperature(agent, QTYPES[q["t"]], k)
    rows = []
    for r in range(len(states)):
        raw = logits[r, :k].astype(float)
        p = _softmax(raw / temp["applied"])
        rows.append({
            "logits": [round(float(x), 4) for x in raw],
            "probs": [round(float(x), 4) for x in p],
            "prediction": int(p.argmax()),
            "confidence": round(confidence_from_probs(p, k), 4),
            "act": round(float(act[r, 0]), 4),
        })
    return {"labels": _labels(q), "temperature": temp, "rows": rows, "timing_ms": round(ms, 1)}


def model_info(agent) -> Dict[str, Any]:
    cfg = agent.cfg
    return {
        "encoder": cfg.get("encoder"),
        "head_layers": cfg.get("head_layers"),
        "max_len": cfg.get("max_len"),
        "head_max_len": cfg.get("head_max_len"),
        "act_costs": cfg.get("act_costs"),
        "cost_wrong_act": cfg.get("cost_wrong_act"),
        "training": cfg.get("training"),
        "device": str(agent.device),
        "dtype": str(agent.dtype).replace("torch.", ""),
        "parameters": sum(p.numel() for p in agent.model.parameters()),
        "temperature": {
            "by_type_shipped": dict(zip(QTYPES, [round(float(t), 4) for t in agent.temperature_raw])),
            "by_type_applied": dict(zip(QTYPES, [round(float(t), 4) for t in agent.temperature])),
            "by_bucket_shipped": {k: round(float(v), 4) for k, v in agent.temperature_by_options_raw.items()},
            "by_bucket_applied": {k: round(float(v), 4) for k, v in agent.temperature_by_options.items()},
        },
    }
