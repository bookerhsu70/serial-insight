#!/usr/bin/env python3
"""將整合設備清單.xlsx 正規化為前端可快速查詢的 JSON。"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date, datetime
from pathlib import Path

import openpyxl

SOURCE = Path("/home/ubuntu/upload/整合設備清單.xlsx")
OUTPUT = Path("data/equipment.json")

FIELD_ALIASES = {
    "customerName": ["客戶名稱"],
    "model": ["設備型號"],
    "clusterName": ["Cluster Name"],
    "serialNumber": ["序號"],
    "region": ["地區"],
    "warrantyType": ["保固類型(原廠 or 文偉)"],
    "expiry": ["維護到期日", "保固到期日", "維護起訖"],
    "systemVersion": ["系統版本"],
    "contactName": ["客戶窗口"],
    "contactEmail": ["客戶 e-mail", "客戶email"],
    "contactPhone": ["客戶電話"],
    "sales": ["業務"],
    "accountSe1": ["Account SE1"],
    "accountSe2": ["Account SE2"],
}


def clean(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y/%-m/%-d")
    text = str(value).replace("\u200b", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def split_serials(value: object) -> list[str]:
    if value is None:
        return []
    # 先保留換行再切分；若先走 clean()，換行會被壓成空白而無法辨識多組序號。
    raw = str(value).replace("\u200b", "").strip()
    if not raw:
        return []
    # 多組序號常以換行或中英文分號、逗號分隔；不以空白拆分，避免破壞含空白的設備識別值。
    parts = re.split(r"[\r\n;,，；]+", raw)
    return [clean(part) for part in parts if clean(part)]


def field_index(headers: list[str], aliases: list[str]) -> int | None:
    for alias in aliases:
        if alias in headers:
            return headers.index(alias)
    return None


def main() -> None:
    workbook = openpyxl.load_workbook(SOURCE, data_only=True)
    records: list[dict[str, str | int]] = []
    raw_rows = 0
    unsearchable_rows = 0
    source_row_counts: Counter[str] = Counter()

    for worksheet in workbook.worksheets:
        headers = [clean(cell.value) for cell in worksheet[1]]
        indices = {key: field_index(headers, aliases) for key, aliases in FIELD_ALIASES.items()}
        for row_number, row in enumerate(worksheet.iter_rows(min_row=2, values_only=True), start=2):
            values = list(row)
            if not any(clean(value) for value in values):
                continue
            raw_rows += 1
            row_values: dict[str, str] = {}
            for key, index in indices.items():
                row_values[key] = clean(values[index]) if index is not None and index < len(values) else ""
            serial_index = indices.get("serialNumber")
            raw_serial_value = values[serial_index] if serial_index is not None and serial_index < len(values) else ""
            serials = split_serials(raw_serial_value)
            if not serials:
                unsearchable_rows += 1
                continue
            for serial in serials:
                records.append(
                    {
                        "customerName": row_values["customerName"],
                        "model": row_values["model"],
                        "clusterName": row_values["clusterName"],
                        "serialNumber": serial,
                        "region": row_values["region"],
                        "warrantyType": row_values["warrantyType"],
                        "expiry": row_values["expiry"],
                        "systemVersion": row_values["systemVersion"],
                        "contactName": row_values["contactName"],
                        "contactEmail": row_values["contactEmail"],
                        "contactPhone": row_values["contactPhone"],
                        "sales": row_values["sales"],
                        "accountSe1": row_values["accountSe1"],
                        "accountSe2": row_values["accountSe2"],
                        "sourceSheet": worksheet.title,
                        "sourceRow": row_number,
                    }
                )
            source_row_counts[worksheet.title] += 1

    customers = sorted({r["customerName"] for r in records if r["customerName"]})
    regions = sorted({r["region"] for r in records if r["region"]})
    warranties = sorted({r["warrantyType"] for r in records if r["warrantyType"]})
    payload = {
        "sourceFile": SOURCE.name,
        "sourceSheets": workbook.sheetnames,
        "stats": {
            "rawRows": raw_rows,
            "searchableRecords": len(records),
            "unsearchableRows": unsearchable_rows,
            "customerCount": len(customers),
            "regionCount": len(regions),
            "warrantyCount": len(warranties),
            "sourceRowCounts": dict(source_row_counts),
            "customers": customers,
            "regions": regions,
            "warranties": warranties,
        },
        "records": records,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), **payload["stats"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
