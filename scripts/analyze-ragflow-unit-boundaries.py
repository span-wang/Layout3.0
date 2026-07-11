import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORK_ROOT = PROJECT_ROOT / ".ragflow-work" / "english-shadow-v1"
AUDIT_PATH = WORK_ROOT / "source-audit.json"
OUTPUT_PATH = PROJECT_ROOT / "evaluation" / "ragflow" / "data-cleaning" / "english-unit-boundary-analysis.v1.json"

# 只分析已由文件名或元数据明确判定为跨单元、全册或零切片待修复的资料。
CANDIDATE_IDS = {
    "d0ca17707b8c11f1b1eacb449d41f0c3",
    "43cff4027b8c11f1b1eacb449d41f0c3",
    "43e1004e7b8c11f1b1eacb449d41f0c3",
    "443f38267b8c11f1b1eacb449d41f0c3",
    "444550f87b8c11f1b1eacb449d41f0c3",
    "444ba52a7b8c11f1b1eacb449d41f0c3",
    "4459ec167b8c11f1b1eacb449d41f0c3",
    "d0fde9ec7b8c11f1b1eacb449d41f0c3",
    "5846140c7b8c11f1b1eacb449d41f0c3",
    "447ecab87b8c11f1b1eacb449d41f0c3",
    "448f711a7b8c11f1b1eacb449d41f0c3",
    "a0e83e6a79f711f1a93a9523fdaa939b",
    "58dd3cce7b8c11f1b1eacb449d41f0c3",
    "ce5dac7279f711f1a93a9523fdaa939b",
    "cefdd4ae79f711f1a93a9523fdaa939b",
    "cf246d9e79f711f1a93a9523fdaa939b",
    "5877b70a7b8c11f1b1eacb449d41f0c3",
}

UNIT_PATTERNS = {
    "starter_unit_1": re.compile(r"starter\s*unit\s*1\b", re.IGNORECASE),
    "starter_unit_2": re.compile(r"starter\s*unit\s*2\b", re.IGNORECASE),
    "starter_unit_3": re.compile(r"starter\s*unit\s*3\b", re.IGNORECASE),
    "unit_1": re.compile(r"unit\s*1\s*(?:you\s*and\s*me)?", re.IGNORECASE),
    "unit_2": re.compile(r"unit\s*2\s*(?:we.?re\s*family)?", re.IGNORECASE),
    "unit_3": re.compile(r"unit\s*3\s*(?:my\s*school)?", re.IGNORECASE),
    "unit_4": re.compile(r"unit\s*4\s*(?:my\s*favou?rite\s*subject)?", re.IGNORECASE),
    "unit_5": re.compile(r"unit\s*5\s*(?:fun\s*clubs)?", re.IGNORECASE),
    "unit_6": re.compile(r"unit\s*6\s*(?:a\s*day\s*in\s*the\s*life)?", re.IGNORECASE),
    "unit_7": re.compile(r"unit\s*7\s*(?:happy\s*birthday)?", re.IGNORECASE),
}


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("’", "'").replace("！", "!")).strip()


def sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
entries_by_id = {entry["documentId"]: entry for entry in audit["entries"]}
missing_ids = sorted(CANDIDATE_IDS - entries_by_id.keys())
if missing_ids:
    raise RuntimeError(f"拆分候选缺少源审计记录：{missing_ids}")

documents = []
for index, document_id in enumerate(sorted(CANDIDATE_IDS), start=1):
    entry = entries_by_id[document_id]
    original_path = WORK_ROOT / entry["localFile"]
    if entry["documentName"].lower().endswith(".docx"):
        pdf_path = WORK_ROOT / "analysis-pdf" / f"{document_id}.pdf"
    else:
        pdf_path = original_path

    result = {
        "documentId": document_id,
        "documentName": entry["documentName"],
        "sourceSha256": entry["sha256"],
        "analysisFileSha256": None,
        "pageCount": 0,
        "textPageCount": 0,
        "unitOccurrences": {unit: [] for unit in UNIT_PATTERNS},
        "status": "analyzed",
        "error": None,
    }
    try:
        reader = PdfReader(str(pdf_path), strict=False)
        result["analysisFileSha256"] = sha256(pdf_path)
        result["pageCount"] = len(reader.pages)
        for page_number, page in enumerate(reader.pages, start=1):
            text = normalize_text(page.extract_text() or "")
            if text:
                result["textPageCount"] += 1
            for unit, pattern in UNIT_PATTERNS.items():
                match = pattern.search(text)
                if match:
                    start = max(0, match.start() - 45)
                    end = min(len(text), match.end() + 95)
                    result["unitOccurrences"][unit].append({
                        "page": page_number,
                        "preview": text[start:end],
                    })
    except Exception as error:  # 保留真实解析错误，后续进入隔离或人工复核。
        result["status"] = "analysis_failed"
        result["error"] = str(error)
    documents.append(result)
    print(f"[{index}/{len(CANDIDATE_IDS)}] {result['status']}：{entry['documentName']}，页数 {result['pageCount']}，文本页 {result['textPageCount']}")

report = {
    "schemaVersion": 1,
    "taskId": "PH3-12-data-cleaning-shadow-kb-v1",
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "candidateCount": len(documents),
    "analyzedCount": sum(document["status"] == "analyzed" for document in documents),
    "failedCount": sum(document["status"] != "analyzed" for document in documents),
    "documents": documents,
}
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"单元边界分析完成：成功 {report['analyzedCount']}，失败 {report['failedCount']}。")
