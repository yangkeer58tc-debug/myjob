#!/usr/bin/env python3
"""
Match MX real posts CSV to a resume snapshot CSV (token overlap + category hints).

Example:
  python3 scripts/match-mx-posts-to-resumes.py \\
    --posts /Users/a58/Desktop/MX真实帖子.csv \\
    --categories /Users/a58/Desktop/MX真实帖子的category.csv \\
    --resumes tmp/resumes.csv \\
    --out tmp/mx_posts_resume_matches.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


def fold(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


STOP = set(
    """
el la los las un una unos unas y o de del al en por para con sin sobre entre
que como cuando donde quien cual cuales este esta estos estas ese esa esos esas
the a an and or of to in on for with from at by be is are was were been being
have has had do does did will would could should may might must can
se su sus son es eran era ser está están fue fueron hay ha he sido si no más
muy todo todos toda todas otro otra otros otras mismo misma un uno una
""".split()
)


def tokens(s: str) -> set[str]:
    s = fold(s)
    out = set(re.findall(r"[a-záéíóúñü0-9]+", s, flags=re.I))
    short_ok = {"rh", "ux", "it", "cd", "mx"}
    return {t for t in out if t not in STOP and (len(t) > 2 or t in short_ok)}


def load_category_tokens(cat_path: Path) -> dict[str, set[str]]:
    cat_tokens: dict[str, set[str]] = {}
    with cat_path.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            code = (row.get("code") or "").strip().lower()
            if not code:
                continue
            toks: set[str] = set()
            toks.update(re.findall(r"[a-záéíóúñü0-9]+", code.replace("-", " "), flags=re.I))
            path = row.get("path") or ""
            for p in path.replace(",", " ").split("/"):
                toks.update(re.findall(r"[a-záéíóúñü0-9]+", p.lower(), flags=re.I))
            name_raw = (row.get("name") or "").strip()
            if name_raw:
                try:
                    j = json.loads(name_raw)
                    for k in ("en", "es"):
                        t = (j.get(k) or "").lower()
                        toks.update(re.findall(r"[a-záéíóúñü0-9]+", t, flags=re.I))
                except Exception:
                    toks.update(re.findall(r"[a-záéíóúñü0-9]+", name_raw.lower(), flags=re.I))
            cat_tokens[code] = {x for x in toks if len(x) > 2 or x in {"ux", "rh", "it"}}
    return cat_tokens


def broad_bucket(code: str) -> str:
    c = code.lower()
    if re.search(r"cust-service|call|atencion|support|telefon|helpdesk|mesa|recepcion|recepci", c):
        return "call_center"
    if re.search(r"sales|venta|vendedor|comercial|merchant", c):
        return "sales"
    if re.search(r"logistics|transport|courier|driver|chofer|reparto|almacen|warehouse|bodega", c):
        return "logistics"
    if re.search(r"health|medical|nurse|hospital|clinic|dental|nutri", c):
        return "health"
    if re.search(r"admin|secretar|asistente|oficina", c):
        return "admin"
    return "general"


BUCKET_KEYWORDS: dict[str, set[str]] = {
    "call_center": tokens(
        "atención cliente call center telefono ventas mostrador servicio mesa ayuda"
    ),
    "sales": tokens("ventas vendedor comercial promotor demostrador negocio clientes"),
    "logistics": tokens(
        "almacén logística reparto chofer conductor inventario embarques bodega montacargas"
    ),
    "health": tokens("enfermería médico hospital clínica paciente salud"),
    "admin": tokens(
        "administración oficina secretaria asistente documentos agenda recepción contabilidad"
    ),
    "general": set(),
}


def score(post: dict, res: dict) -> float:
    pt, rt = post["post_tokens"], res["resume_tokens"]
    if not pt or not rt:
        return 0.0
    inter = pt & rt
    base = len(inter) / (len(pt) ** 0.5 + 1e-6)
    blob = fold(post["title"] + " " + post["raw_content"])
    jd = fold(res["job_direction"])
    boost = 0.0
    if len(jd) > 4 and jd in blob:
        boost += 2.5
    for w in jd.split():
        if len(w) > 5 and w in blob:
            boost += 0.8
    bk = BUCKET_KEYWORDS.get(post["bucket"], set())
    boost += len(bk & rt) * 0.35
    return base + boost


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--posts", type=Path, required=True)
    ap.add_argument("--categories", type=Path, required=True)
    ap.add_argument("--resumes", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--min-score", type=float, default=0.35)
    ap.add_argument("--min-score-floor", type=float, default=0.12)
    args = ap.parse_args()

    cat_tokens = load_category_tokens(args.categories)

    content_by_id: dict[str, str] = {}
    posts: list[dict] = []
    with args.posts.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            iid = (row.get("info_id") or "").strip()
            if not iid:
                continue
            code = (row.get("cate_code") or "").strip().lower()
            title = row.get("title") or ""
            content = (row.get("content") or "")[:8000]
            content_by_id[iid] = content
            pt = tokens(title + " " + content)
            pt |= cat_tokens.get(code, set())
            bucket = broad_bucket(code)
            pt |= BUCKET_KEYWORDS.get(bucket, set())
            posts.append(
                {
                    "id": iid,
                    "cate_code": code,
                    "title": title,
                    "post_tokens": pt,
                    "bucket": bucket,
                }
            )

    for p in posts:
        p["raw_content"] = content_by_id.get(p["id"], "")

    resumes: list[dict] = []
    with args.resumes.open(encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            rid = (row.get("id") or "").strip()
            if not rid:
                continue
            jd = row.get("job_direction") or ""
            ps = row.get("profile_summary") or ""
            nm = row.get("name") or ""
            rt = tokens(jd + " " + ps + " " + nm)
            resumes.append(
                {
                    "id": rid,
                    "job_direction": jd,
                    "profile_summary": ps,
                    "resume_tokens": rt,
                }
            )

    rows_out: list[dict] = []
    for p in posts:
        scored = [(score(p, r), r) for r in resumes]
        scored.sort(key=lambda x: -x[0])
        taken = 0
        for s, r in scored:
            if s < args.min_score and taken >= 2:
                break
            if s < args.min_score_floor:
                break
            rows_out.append(
                {
                    "帖子id": p["id"],
                    "简历id": r["id"],
                    "简历下载链接": "",
                    "whatsapp号码": "",
                    "个人总结文字": (r["profile_summary"] or "")
                    .replace("\r\n", " ")
                    .replace("\n", " ")[:2000],
                    "匹配分": f"{s:.2f}",
                    "帖子品类": p["cate_code"],
                    "求职方向": r["job_direction"],
                }
            )
            taken += 1
            if taken >= args.top_k:
                break

    args.out.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "帖子id",
        "简历id",
        "简历下载链接",
        "whatsapp号码",
        "个人总结文字",
        "匹配分",
        "帖子品类",
        "求职方向",
    ]
    with args.out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows_out)

    c = Counter(x["帖子id"] for x in rows_out)
    print(
        f"[match-mx] posts={len(posts)} resumes={len(resumes)} rows={len(rows_out)} "
        f"posts_with_row={len(c)} -> {args.out.resolve()}"
    )


if __name__ == "__main__":
    main()
