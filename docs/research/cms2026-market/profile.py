"""Read the official 2026 CMS PUFs; emit market context, never a paid-customer forecast.

Run with bundled Python: profile.py --cache-dir <download-cache> --output <json>.
Raw archives are public data and stay outside Git. Existing archives are reused.
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

SOURCES = {level: f"https://www.cms.gov/files/zip/2026-oep-{level}-level-public-use-file.zip" for level in ("state", "county")}
STATES = ("TX", "FL", "TN")
FIELDS = ("Cnsmr", "AB_Cnsmr", "APTC_Cnsmr", "Age_26_34", "Age_35_44", "FPL_300_400")


def number(value):
    try:
        return int(value.strip().replace(",", ""))
    except (ValueError, AttributeError):
        return None  # Suppressed / NR / missing is never zero.


def load(level, cache):
    archive = cache / f"{level}.zip"
    if not archive.exists():
        archive.write_bytes(urllib.request.urlopen(SOURCES[level], timeout=45).read())
    data = archive.read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if len(names) != 1:
            raise ValueError(f"Expected one CSV for {level}, got {names}")
        rows = list(csv.DictReader(io.StringIO(z.read(names[0]).decode("utf-8-sig"))))
    return rows, {"url": SOURCES[level], "archive_sha256": hashlib.sha256(data).hexdigest(), "csv_member": names[0]}


def describe(row):
    result = {field: number(row.get(field)) for field in FIELDS}
    result["published_age_26_44"] = result["Age_26_34"] + result["Age_35_44"]
    result["broker_assisted_share"] = result["AB_Cnsmr"] / result["Cnsmr"] if result["AB_Cnsmr"] is not None else None
    result["published_fpl_300_400_share"] = result["FPL_300_400"] / result["Cnsmr"]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    states, state_source = load("state", args.cache_dir)
    counties, county_source = load("county", args.cache_dir)
    state_rows = {s: [r for r in states if r.get("State_Abrvtn") == s] for s in STATES}
    if any(len(v) != 1 for v in state_rows.values()):
        raise ValueError("State keys are missing or duplicated")
    selected = {s: describe(v[0]) for s, v in state_rows.items()}
    totals = {key: sum(v[key] for v in selected.values()) for key in (*FIELDS, "published_age_26_44")}
    totals["broker_assisted_share"] = totals["AB_Cnsmr"] / totals["Cnsmr"]
    totals["published_fpl_300_400_share"] = totals["FPL_300_400"] / totals["Cnsmr"]
    # Sum only the 51 individual state/DC records; exclude three platform/US subtotal rows.
    unique_states = [r for r in states if len(r.get("State_Abrvtn", "")) == 2]
    if len(unique_states) != 51 or len({r["State_Abrvtn"] for r in unique_states}) != 51:
        raise ValueError("Expected 50 states plus DC exactly once")
    national = {key: sum(number(r[key]) for r in unique_states) for key in ("Cnsmr", "Age_26_34", "Age_35_44", "FPL_300_400")}
    national["published_age_26_44"] = national["Age_26_34"] + national["Age_35_44"]
    # Identify the US subtotal by its independently reconciled enrollment total, not the first 'Total'.
    matching = [r for r in states if r.get("State_Abrvtn") == "Total" and number(r["Cnsmr"]) == national["Cnsmr"]]
    if len(matching) != 1:
        raise ValueError("National source control could not be resolved")
    for key in ("Cnsmr", "Age_26_34", "Age_35_44", "FPL_300_400"):
        if number(matching[0][key]) != national[key]:
            raise ValueError(f"National control differs: {key}")
    selected_counties = [r for r in counties if r.get("State_Abrvtn") in STATES]
    comparable = [r for r in selected_counties if number(r["FPL_300_400"]) is not None]
    top = sorted(comparable, key=lambda r: number(r["FPL_300_400"]), reverse=True)[:12]
    controls = {}
    for state in STATES:
        rows = [r for r in selected_counties if r["State_Abrvtn"] == state]
        controls[state] = {}
        for field in ("Cnsmr", "FPL_300_400"):
            values = [number(r[field]) for r in rows]
            known = sum(v for v in values if v is not None)
            controls[state][field] = {"known_county_sum": known, "suppressed_or_missing_county_cells": values.count(None), "state_count": selected[state][field], "state_minus_known_counties": selected[state][field] - known}
            if not values.count(None) and known != selected[state][field]:
                raise ValueError(f"Unexplained county/state difference: {state} {field}")
    result = {
        "retrieved_on": "2026-11-15",
        "source_page": "https://www.cms.gov/data-research/statistics-trends-reports/marketplace-products/2026-marketplace-open-enrollment-period-public-use-files",
        "definitions_url": "https://www.cms.gov/files/document/2026-public-use-files-definitions.pdf",
        "sources": {"state": state_source, "county": county_source},
        "unit": "Unique people with 2026 OEP medical plan selections, not households or effectuated enrollment",
        "age": "Sum of published Age_26_34 and Age_35_44 bands; not a direct count of current-age 25-45 people",
        "income_band": "Published household income >300% and <=400% FPL; not profit, not necessarily near an imminent cliff",
        "joint_segments": "Not available: age, self-employment, income, household, negotiable contracts, willingness to pay cannot be joined from marginal counts",
        "states": selected,
        "three_state_total": totals,
        "national_controlled_total": national,
        "county_controls": controls,
        "top_counties_by_published_fpl_300_400_count": [{"state": r["State_Abrvtn"], "county_fips": r["County_FIPS_Cd"], **describe(r)} for r in top],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"three_states": totals, "national": national, "county_controls": controls}, indent=2))


if __name__ == "__main__":
    main()
