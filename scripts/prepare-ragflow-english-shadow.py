import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader, PdfWriter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORK_ROOT = PROJECT_ROOT / ".ragflow-work" / "english-shadow-v1"
ORIGINALS_ROOT = WORK_ROOT / "originals"
CONVERTED_ROOT = WORK_ROOT / "converted-docx"
ANALYSIS_PDF_ROOT = WORK_ROOT / "analysis-pdf"
CONTROLLED_ROOT = WORK_ROOT / "controlled-units"
CORPUS_ROOT = WORK_ROOT / "shadow-corpus"
EVALUATION_ROOT = PROJECT_ROOT / "evaluation" / "ragflow"
DATA_CLEANING_ROOT = EVALUATION_ROOT / "data-cleaning"


def read_json(file_path: Path):
    return json.loads(file_path.read_text(encoding="utf-8-sig"))


def write_json(file_path: Path, value):
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_short_name(value: str, extension: str) -> str:
    stem = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", "_", Path(value).stem).strip(" ._")
    while len((stem + extension).encode("utf-8")) > 110:
        stem = stem[:-1]
    return (stem or "document") + extension


def ensure_hardlink(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != source.stat().st_size or sha256(target) != sha256(source):
            raise RuntimeError(f"影子语料文件与源文件不一致：{target}")
        return
    os.link(source, target)


source_audit = read_json(WORK_ROOT / "source-audit.json")
governance_manifest = read_json(EVALUATION_ROOT / "metadata" / "manifest.v1.json")
conversion_report = read_json(DATA_CLEANING_ROOT / "english-doc-conversion.v1.json")
split_plan = read_json(DATA_CLEANING_ROOT / "english-controlled-split-plan.v1.json")

audit_by_id = {entry["documentId"]: entry for entry in source_audit["entries"]}
english_governance = next(dataset for dataset in governance_manifest["datasets"] if dataset["datasetCode"] == "english_grade7_rj_v1")
governance_by_id = {entry["documentId"]: entry for entry in english_governance["entries"]}
conversion_by_id = {entry["documentId"]: entry for entry in conversion_report["entries"]}
split_ids = {source["documentId"] for source in split_plan["splitSources"]}
general_ids = {source["documentId"] for source in split_plan["generalCopies"]}
excluded_ids = {source["documentId"] for source in split_plan["excludedSources"]}

if split_ids & excluded_ids or general_ids & excluded_ids or split_ids & general_ids:
    raise RuntimeError("拆分、通用和排除清单存在重复文档 ID。")

CONTROLLED_ROOT.mkdir(parents=True, exist_ok=True)
CORPUS_ROOT.mkdir(parents=True, exist_ok=True)
corpus_entries = []

# 受控拆分只消费计划中明确列出的物理页范围，不自动推测缺失边界。
for source in split_plan["splitSources"]:
    document_id = source["documentId"]
    audit_entry = audit_by_id[document_id]
    governance_entry = governance_by_id[document_id]
    if source["sourceKind"] == "analysis_pdf":
        source_path = ANALYSIS_PDF_ROOT / f"{document_id}.pdf"
    else:
        source_path = WORK_ROOT / audit_entry["localFile"]
    reader = PdfReader(str(source_path), strict=False)
    for split in source["splits"]:
        writer = PdfWriter()
        expected_page_count = 0
        for first_page, last_page in split["ranges"]:
            if first_page < 1 or last_page > len(reader.pages) or first_page > last_page:
                raise RuntimeError(f"拆分页码越界：{source['sourceName']} {split['unit']} {first_page}-{last_page}")
            for page_number in range(first_page, last_page + 1):
                writer.add_page(reader.pages[page_number - 1])
                expected_page_count += 1
        controlled_name = f"{document_id}__{split['unit']}__{governance_entry['governedMetadata']['content_role']}.pdf"
        controlled_path = CONTROLLED_ROOT / controlled_name
        with controlled_path.open("wb") as output:
            writer.write(output)
        if len(PdfReader(str(controlled_path), strict=False).pages) != expected_page_count:
            raise RuntimeError(f"拆分页数核验失败：{controlled_name}")
        corpus_path = CORPUS_ROOT / controlled_name
        ensure_hardlink(controlled_path, corpus_path)
        corpus_entries.append({
            "file": controlled_name,
            "documentName": controlled_name,
            "originDocumentId": document_id,
            "originDocumentName": source["sourceName"],
            "unit": split["unit"],
            "contentRole": governance_entry["governedMetadata"]["content_role"],
            "resourceType": "pdf",
            "year": governance_entry["governedMetadata"]["year"],
            "pairId": governance_entry["governedMetadata"]["pair_id"],
            "treatment": "controlled_split",
            "pageRanges": split["ranges"],
            "size": controlled_path.stat().st_size,
            "sha256": sha256(controlled_path),
        })

# 未列入拆分/排除的健康单元资料直接进入影子语料；旧 DOC 必须换成已验证 DOCX。
for audit_entry in source_audit["entries"]:
    document_id = audit_entry["documentId"]
    if document_id in split_ids or document_id in excluded_ids:
        continue
    governance_entry = governance_by_id[document_id]
    metadata = governance_entry["governedMetadata"]
    if audit_entry["documentName"].lower().endswith(".doc"):
        converted = conversion_by_id.get(document_id)
        if not converted or converted["status"] != "converted":
            raise RuntimeError(f"旧 DOC 尚未完成转换：{audit_entry['documentName']}")
        source_path = WORK_ROOT / converted["outputFile"]
        document_name = safe_short_name(audit_entry["documentName"], ".docx")
        treatment = "converted_docx"
        resource_type = "docx"
    else:
        source_path = WORK_ROOT / audit_entry["localFile"]
        document_name = safe_short_name(audit_entry["documentName"], source_path.suffix.lower())
        treatment = "general_copy" if document_id in general_ids else "healthy_copy"
        resource_type = source_path.suffix.lower().removeprefix(".")
    unit = "general" if document_id in general_ids else metadata["unit"]
    if isinstance(unit, list) or unit == "unknown":
        raise RuntimeError(f"未受控的跨单元/未知单元资料仍将进入影子语料：{audit_entry['documentName']}")
    corpus_name = f"{document_id}__{document_name}"
    corpus_path = CORPUS_ROOT / corpus_name
    ensure_hardlink(source_path, corpus_path)
    corpus_entries.append({
        "file": corpus_name,
        "documentName": corpus_name,
        "originDocumentId": document_id,
        "originDocumentName": audit_entry["documentName"],
        "unit": unit,
        "contentRole": metadata["content_role"],
        "resourceType": resource_type,
        "year": metadata["year"],
        "pairId": metadata["pair_id"],
        "treatment": treatment,
        "pageRanges": None,
        "size": source_path.stat().st_size,
        "sha256": sha256(source_path),
    })

if any(entry["size"] <= 0 for entry in corpus_entries):
    raise RuntimeError("影子语料存在空文件。")
if any(Path(entry["file"]).suffix.lower() in {".doc", ".mp3"} for entry in corpus_entries):
    raise RuntimeError("影子语料仍包含旧 DOC 或 MP3。")
if len({entry["file"] for entry in corpus_entries}) != len(corpus_entries):
    raise RuntimeError("影子语料文件名重复。")

report = {
    "schemaVersion": 1,
    "taskId": "PH3-12-data-cleaning-shadow-kb-v1",
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "documentCount": len(corpus_entries),
    "controlledSplitCount": sum(entry["treatment"] == "controlled_split" for entry in corpus_entries),
    "convertedDocxCount": sum(entry["treatment"] == "converted_docx" for entry in corpus_entries),
    "generalCopyCount": sum(entry["treatment"] == "general_copy" for entry in corpus_entries),
    "generalUnitCount": sum(entry["unit"] == "general" for entry in corpus_entries),
    "zeroSizeCount": 0,
    "legacyDocCount": 0,
    "audioCount": 0,
    "entries": sorted(corpus_entries, key=lambda entry: entry["file"]),
    "excludedSources": split_plan["excludedSources"],
}
write_json(WORK_ROOT / "shadow-corpus-manifest.json", report)
write_json(DATA_CLEANING_ROOT / "english-shadow-corpus-manifest.v1.json", report)
print(
    f"英语影子语料准备完成：{report['documentCount']} 份，"
    f"受控拆分 {report['controlledSplitCount']} 份，DOCX 转换 {report['convertedDocxCount']} 份，"
    f"通用资料 {report['generalCopyCount']} 份。"
)
