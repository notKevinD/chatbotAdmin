#!/usr/bin/env python3
"""Evaluate exported chatbot data with RAGAS and write the scores to Excel."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


REQUIRED_COLUMNS = {"question", "answer", "context"}
REFERENCE_FREE_METRICS = (
    "faithfulness",
    "answer_relevancy",
    "context_utilization",
)
REFERENCE_METRICS = (
    "context_precision",
    "context_recall",
    "factual_correctness",
)
PERFORMANCE_COLUMNS = (
    "response_time_ms",
    "evaluation_time_seconds",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Membaca Excel hasil ekspor ragas_data, menjalankan evaluasi RAGAS, "
            "dan menyimpan skor per pertanyaan ke Excel baru."
        )
    )
    parser.add_argument("input", type=Path, help="File Excel hasil Ekspor Data RAGAS.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Lokasi hasil. Default: <nama-input>-hasil-ragas.xlsx",
    )
    parser.add_argument(
        "--sheet",
        default=0,
        help="Nama atau nomor sheet input. Default: sheet pertama.",
    )
    parser.add_argument(
        "--llm-model",
        default=os.getenv("RAGAS_LLM_MODEL", "gpt-4o-mini"),
        help="Model OpenAI untuk evaluator. Default: gpt-4o-mini.",
    )
    parser.add_argument(
        "--embedding-model",
        default=os.getenv("RAGAS_EMBEDDING_MODEL", "text-embedding-3-small"),
        help="Model embedding evaluator. Default: text-embedding-3-small.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Batasi jumlah baris untuk uji coba. Nilai 0 berarti semua data.",
    )
    parser.add_argument(
        "--start-row",
        type=int,
        default=1,
        help="Mulai dari nomor data tertentu (1-based). Default: 1.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.2,
        help="Jeda antardata dalam detik untuk mengurangi risiko rate limit.",
    )
    return parser.parse_args()


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def context_item_to_text(item: Any) -> str:
    if isinstance(item, str):
        nested = try_parse_json(item)
        if nested is not item:
            return context_item_to_text(nested)
        return item.strip()

    if isinstance(item, dict):
        for key in ("pageContent", "page_content", "content", "text"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return json.dumps(item, ensure_ascii=False)

    if item is None:
        return ""

    return str(item).strip()


def try_parse_json(value: str) -> Any:
    text = value.strip()
    if not text or text[0] not in "[{":
        return value

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def parse_contexts(value: Any) -> list[str]:
    if value is None:
        return []

    parsed = try_parse_json(value) if isinstance(value, str) else value

    if isinstance(parsed, dict):
        for key in ("retrieved_contexts", "contexts", "context"):
            if key in parsed:
                parsed = parsed[key]
                break
        else:
            parsed = [parsed]

    if not isinstance(parsed, list):
        parsed = [parsed]

    contexts = [context_item_to_text(item) for item in parsed]
    return [context for context in contexts if context]


def score_value(result: Any) -> float | None:
    value = getattr(result, "value", result)
    try:
        return round(float(value), 6)
    except (TypeError, ValueError):
        return None


def load_input(path: Path, sheet: str | int, start_row: int, limit: int):
    try:
        import pandas as pd
    except ImportError as error:
        raise RuntimeError(
            "Pandas belum terpasang. Jalankan: pip install -r requirements-ragas.txt"
        ) from error

    if not path.exists():
        raise FileNotFoundError(f"File input tidak ditemukan: {path}")

    selected_sheet: str | int = int(sheet) if isinstance(sheet, str) and sheet.isdigit() else sheet
    frame = pd.read_excel(path, sheet_name=selected_sheet)
    frame.columns = [str(column).strip().lower() for column in frame.columns]

    missing = REQUIRED_COLUMNS - set(frame.columns)
    if missing:
        raise ValueError(
            "Kolom wajib tidak ditemukan: "
            + ", ".join(sorted(missing))
            + ". Kolom yang dibutuhkan: question, answer, context."
        )

    if "reference" not in frame.columns:
        frame["reference"] = ""
    if "response_time_ms" not in frame.columns:
        frame["response_time_ms"] = None

    frame = frame.iloc[max(start_row - 1, 0) :]
    if limit > 0:
        frame = frame.head(limit)

    frame = frame.copy()
    frame["question"] = frame["question"].map(normalize_text)
    frame["answer"] = frame["answer"].map(normalize_text)
    frame["reference"] = frame["reference"].map(normalize_text)
    frame["_contexts"] = frame["context"].map(parse_contexts)
    frame["_source_row"] = range(start_row, start_row + len(frame))

    invalid = frame[
        (frame["question"] == "")
        | (frame["answer"] == "")
        | (frame["_contexts"].map(len) == 0)
    ]
    if not invalid.empty:
        rows = ", ".join(str(value) for value in invalid["_source_row"].tolist()[:10])
        raise ValueError(
            f"Ada question, answer, atau context kosong pada data nomor: {rows}. "
            "Perbaiki data sebelum menjalankan evaluasi."
        )

    return frame


def build_scorers(llm_model: str, embedding_model: str):
    try:
        from openai import AsyncOpenAI
        from ragas.embeddings.base import embedding_factory
        from ragas.llms import llm_factory
        from ragas.metrics.collections import (
            AnswerRelevancy,
            ContextPrecision,
            ContextRecall,
            ContextUtilization,
            Faithfulness,
            FactualCorrectness,
        )
    except ImportError as error:
        raise RuntimeError(
            "Dependency RAGAS belum lengkap. Jalankan: "
            "pip install -r requirements-ragas.txt"
        ) from error

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("Environment variable OPENAI_API_KEY belum diisi.")

    client = AsyncOpenAI()
    llm = llm_factory(llm_model, client=client)
    embeddings = embedding_factory(
        "openai",
        model=embedding_model,
        client=client,
    )

    return {
        "faithfulness": Faithfulness(llm=llm),
        "answer_relevancy": AnswerRelevancy(llm=llm, embeddings=embeddings),
        "context_utilization": ContextUtilization(llm=llm),
        "context_precision": ContextPrecision(llm=llm),
        "context_recall": ContextRecall(llm=llm),
        "factual_correctness": FactualCorrectness(llm=llm),
    }


async def evaluate_row(
    scorers: dict[str, Any],
    question: str,
    answer: str,
    contexts: list[str],
    reference: str,
) -> dict[str, float | None]:
    scores: dict[str, float | None] = {}

    calls = {
        "faithfulness": scorers["faithfulness"].ascore(
            user_input=question,
            response=answer,
            retrieved_contexts=contexts,
        ),
        "answer_relevancy": scorers["answer_relevancy"].ascore(
            user_input=question,
            response=answer,
        ),
        "context_utilization": scorers["context_utilization"].ascore(
            user_input=question,
            response=answer,
            retrieved_contexts=contexts,
        ),
    }

    if reference:
        calls.update(
            {
                "context_precision": scorers["context_precision"].ascore(
                    user_input=question,
                    reference=reference,
                    retrieved_contexts=contexts,
                ),
                "context_recall": scorers["context_recall"].ascore(
                    user_input=question,
                    reference=reference,
                    retrieved_contexts=contexts,
                ),
                "factual_correctness": scorers["factual_correctness"].ascore(
                    response=answer,
                    reference=reference,
                ),
            }
        )

    names = list(calls)
    results = await asyncio.gather(*calls.values(), return_exceptions=True)

    for name, result in zip(names, results):
        if isinstance(result, Exception):
            print(f"  Peringatan: metrik {name} gagal: {result}", file=sys.stderr)
            scores[name] = None
        else:
            scores[name] = score_value(result)

    for name in REFERENCE_METRICS:
        scores.setdefault(name, None)

    return scores


def write_output(result_rows: list[dict[str, Any]], output: Path) -> None:
    import pandas as pd

    result_frame = pd.DataFrame(result_rows)
    summary_columns = list(
        REFERENCE_FREE_METRICS + REFERENCE_METRICS + PERFORMANCE_COLUMNS
    )
    summary_rows = []

    for column in summary_columns:
        valid = pd.to_numeric(result_frame[column], errors="coerce").dropna()
        summary_rows.append(
            {
                "metric": column,
                "mean": round(float(valid.mean()), 6) if not valid.empty else None,
                "minimum": round(float(valid.min()), 6) if not valid.empty else None,
                "maximum": round(float(valid.max()), 6) if not valid.empty else None,
                "evaluated_rows": int(valid.count()),
            }
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        result_frame.to_excel(writer, sheet_name="Hasil RAGAS", index=False)
        pd.DataFrame(summary_rows).to_excel(writer, sheet_name="Ringkasan", index=False)

        detail_sheet = writer.book["Hasil RAGAS"]
        summary_sheet = writer.book["Ringkasan"]
        detail_sheet.freeze_panes = "A2"
        summary_sheet.freeze_panes = "A2"
        detail_sheet.auto_filter.ref = detail_sheet.dimensions
        summary_sheet.auto_filter.ref = summary_sheet.dimensions

        widths = {
            "A": 10,
            "B": 52,
            "C": 64,
            "D": 100,
            "E": 64,
            "F": 24,
        }
        for column, width in widths.items():
            detail_sheet.column_dimensions[column].width = width


async def run(args: argparse.Namespace) -> Path:
    output = args.output or args.input.with_name(
        f"{args.input.stem}-hasil-ragas.xlsx"
    )
    frame = load_input(args.input, args.sheet, args.start_row, args.limit)
    scorers = build_scorers(args.llm_model, args.embedding_model)
    result_rows: list[dict[str, Any]] = []

    print(f"Memulai evaluasi {len(frame)} data...")
    for position, (_, row) in enumerate(frame.iterrows(), start=1):
        question = row["question"]
        reference = row["reference"]
        contexts = row["_contexts"]
        print(
            f"[{position}/{len(frame)}] {question[:80]}"
            + (" (dengan reference)" if reference else "")
        )

        evaluation_started_at = time.perf_counter()
        scores = await evaluate_row(
            scorers=scorers,
            question=question,
            answer=row["answer"],
            contexts=contexts,
            reference=reference,
        )
        evaluation_time_seconds = round(
            time.perf_counter() - evaluation_started_at,
            3,
        )
        result_rows.append(
            {
                "id": row.get("id", ""),
                "question": question,
                "answer": row["answer"],
                "context": json.dumps(contexts, ensure_ascii=False),
                "reference": reference,
                "created_at": row.get("created_at", ""),
                "response_time_ms": row.get("response_time_ms", None),
                "evaluation_time_seconds": evaluation_time_seconds,
                "context_count": len(contexts),
                **scores,
            }
        )

        if args.delay > 0 and position < len(frame):
            await asyncio.sleep(args.delay)

    write_output(result_rows, output)
    return output


def main() -> int:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass

    args = parse_args()
    try:
        output = asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nEvaluasi dihentikan.", file=sys.stderr)
        return 130
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(f"Selesai. Hasil tersimpan di: {output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
