#!/usr/bin/env python3
"""Render PDF pages to crisp PNG previews and link them from a lesson.json.

Requires: python -m pip install pymupdf
Usage from the project root:
  python tools/generate_pdf_previews.py lessons/my-lesson/lesson.pdf
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

try:
    import fitz
except ImportError as exc:
    raise SystemExit(
        "PyMuPDF is not installed. Install it first with: py -m pip install pymupdf"
    ) from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="PDF file to turn into page previews")
    parser.add_argument("--lesson-json", type=Path, default=None, help="lesson.json (defaults to PDF folder/lesson.json)")
    parser.add_argument("--dpi", type=int, default=160, help="Preview resolution (default: 160 DPI)")
    parser.add_argument("--images-dir", type=Path, default=None, help="Output directory (defaults to PDF folder/images)")
    parser.add_argument("--no-index-update", action="store_true", help="Do not update pageCount in lessons/index.json")
    args = parser.parse_args()

    pdf_path = args.pdf.resolve()
    if not pdf_path.is_file():
        raise SystemExit(f"PDF file not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise SystemExit("The supplied file must have a .pdf extension")
    if args.dpi < 72 or args.dpi > 300:
        raise SystemExit("DPI must be between 72 and 300")

    lesson_path = (args.lesson_json or (pdf_path.parent / "lesson.json")).resolve()
    if not lesson_path.is_file():
        raise SystemExit(f"lesson.json not found: {lesson_path}")
    image_dir = (args.images_dir or (pdf_path.parent / "images")).resolve()
    image_dir.mkdir(parents=True, exist_ok=True)

    try:
        lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {lesson_path}: {exc}") from exc

    original_pages = lesson.get("pages") or []
    by_number = {int(item.get("number", 0)): item for item in original_pages if item.get("number") is not None}
    scale = args.dpi / 72.0
    relative_dir = Path(os.path.relpath(image_dir, lesson_path.parent)).as_posix()

    try:
        document = fitz.open(pdf_path)
    except Exception as exc:
        raise SystemExit(f"Could not open PDF: {exc}") from exc

    pages = []
    try:
        for page_number, pdf_page in enumerate(document, start=1):
            output = image_dir / f"page-{page_number}.png"
            pixmap = pdf_page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False, annots=True)
            pixmap.save(output)
            page_data = by_number.get(page_number, {"number": page_number, "label": f"صفحة {page_number}", "activities": []})
            page_data["number"] = page_number
            page_data["previewImage"] = f"{relative_dir}/{output.name}".replace("./", "", 1) if relative_dir != "." else output.name
            page_data.setdefault("activities", [])
            pages.append(page_data)
            print(f"[OK] Page {page_number}/{len(document)} -> {output.relative_to(pdf_path.parent) if output.is_relative_to(pdf_path.parent) else output}")
    finally:
        document.close()

    lesson["pdf"] = os.path.relpath(pdf_path, lesson_path.parent).replace(os.sep, "/")
    lesson["pages"] = pages
    lesson_path.write_text(json.dumps(lesson, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {lesson_path} with {len(pages)} page previews.")

    if not args.no_index_update:
        project_root = Path(__file__).resolve().parents[1]
        index_path = project_root / "lessons" / "index.json"
        if index_path.is_file():
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
                lesson_file_rel = None
                public_dir = project_root
                try:
                    lesson_file_rel = lesson_path.relative_to(public_dir).as_posix()
                except ValueError:
                    pass
                for entry in index.get("lessons", []):
                    if entry.get("id") == lesson.get("id") or (lesson_file_rel and entry.get("lessonFile") == lesson_file_rel):
                        entry["pageCount"] = len(pages)
                        if "activityCount" in entry:
                            entry["activityCount"] = sum(len(page.get("activities", [])) for page in pages)
                        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                        print(f"Updated pageCount in {index_path}")
                        break
            except (json.JSONDecodeError, OSError) as exc:
                print(f"[WARN] Could not update index page count: {exc}")

    print("Done. Restart or refresh the app to see the sharp page images.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
