"""Limited independent arithmetic audit; never edits Claude's reference files.

The county example is synthetic. Availability at an exact address, Marketplace
eligibility, and an actual tax return are NOT verified by this script.
"""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import importlib.util
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2] / "data" / "reference"
REFERENCE = Path(__file__).resolve().parents[2] / "reference" / "legacy" / "engine.py"
spec = importlib.util.spec_from_file_location("cliff_reference", REFERENCE)
e = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = e
spec.loader.exec_module(e)

def money(s):
    return Decimal(s.replace("$", "").replace(",", ""))

def annual_family_premium(plan, adult_factor):
    adult = (money(plan["Premium Adult Individual Age 21"]) * adult_factor).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
    return float((adult * 2 + money(plan["Premium Child Age 0-14"])) * 12)

def independent_high_band(profit, sep, premium, benchmark, year):
    """Exhaustive dollar deductions for this MFJ/one-child/zero-wages example.

    Constants transcribed from IRS source publications, no engine functions or
    engine parameter tables used. Only 300-400% FPL and above-400% branches.
    This checks arithmetic, not the full legal eligibility of a tax return.
    """
    if year == 2026:
        fpl, rate, standard, first_bracket, child = 26650, .0996, 32200, 24800, 2200
    else:
        fpl, rate, standard, first_bracket, child = 27320, .1022, 33200, 25600, 2300
    social_tax = profit * .9235 * .153
    earned = profit - social_tax / 2 - sep
    best = None
    for deduction in range(int(min(premium, earned)) + 1):
        household_income = earned - deduction
        if household_income <= 3 * fpl:
            continue
        contribution = int(Decimal(str(household_income * rate)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        credit = 0 if household_income > 4 * fpl else max(0, min(premium, benchmark - contribution))
        if deduction + credit > premium + .5:
            continue
        taxable = max(0, household_income - standard) * .8
        assert taxable < 100800  # Both years remain within the first two brackets.
        income_tax = max(0, min(taxable, first_bracket) * .10 + max(0, taxable - first_bracket) * .12 - child)
        cash = profit - social_tax - income_tax - premium + credit - sep
        if best is None or cash > best["cash"]:
            best = {"deduction": deduction, "magi": household_income, "ptc": credit, "cash": cash}
    return best

plans26 = json.loads((ROOT / "davidson_tn_silver_2026.json").read_text())["plans"]
plans27 = json.loads((ROOT / "davidson_tn_silver_2027.json").read_text())["plans"]
selected26 = plans26[1]
selected27 = next(x for x in plans27 if x["Plan ID (Standard Component)"] == selected26["Plan ID (Standard Component)"])
premiums = {
    2026: (annual_family_premium(selected26, Decimal("1.246")), annual_family_premium(plans26[1], Decimal("1.246"))),
    2027: (annual_family_premium(selected27, Decimal("1.262")), annual_family_premium(plans27[1], Decimal("1.262"))),
}
rows = []
baseline = None
for label, profit26, sep26, profit27 in [
    ("decline", 118000, 0, 118000),
    ("accept December", 130000, 0, 118000),
    ("accept SEP 3600", 130000, 3600, 118000),
    ("accept SEP 5500", 130000, 5500, 118000),
    ("4000 December / 8000 January", 122000, 0, 126000),
]:
    years = []
    for year, profit, sep in [(2026, profit26, sep26), (2027, profit27, 0)]:
        premium, benchmark = premiums[year]
        h = e.Household(year, "mfj", 3, 1, profit, premium, benchmark, aptc_received=13413 if year == 2026 else 0, sep=sep)
        reference = e.solve(h)
        independent = independent_high_band(profit, sep, premium, benchmark, year)
        years.append({"year": year, "premium": premium, "benchmark": benchmark, "reference": reference, "independent": independent, "cash_difference": reference["cash"] - independent["cash"]})
    cash = sum(x["reference"]["cash"] for x in years)
    if baseline is None:
        baseline = cash
    rows.append({"scenario": label, "cash_delta_two_tax_years": cash-baseline, "gross_retirement_contribution": sep26, "years": years})

h = e.Household(2026, "mfj", 2, 0, 150000, 12000, 12000, wages=80000)
text = (ROOT / "i8962-2026-draft-table2.txt").read_text(encoding="utf-8")
table = text[text.index("Table 2. Applicable Figure"):]
table = table[:table.index("Instructions for Form 8962 (2026)")]
entries = {int(n): float(f) for n, f in re.findall(r"\b(1[3-9]\d|2\d\d)\s+(0\.\d{4})", table)}
entries.update({n:.0210 for n in range(100,133)})
entries.update({n:.0996 for n in range(300,401)})
assert len(entries) == 301
output = {
    "reference_file": "reference/legacy/engine.py",
    "reference_sha256": hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
    "status": "Synthetic family, county-candidate rates, limited independent arithmetic check. Not an independently validated personal tax return or savings claim.",
    "assumptions": ["TN MFJ, one eligible child; adults 38 in 2026 and 39 in 2027", "No wages, other income, employer coverage, government coverage, or coverage changes", "All three people eligible for full-year PTC; address availability not independently confirmed", "Selected plan ID stays the same in the modeled 2027 choice; this is not a claim about automatic renewal", "No extra project costs or labor/opportunity costs", "APTC 13413 is an illustrative input, not an actual Marketplace record", "Cash figures are after eventual settlement of both tax years, not bank balances on December 31", "Retirement principal is reported separately, before future withdrawal taxes"],
    "table_2026": {"source_status": "IRS draft 8962 instructions", "checked": len(entries), "mismatches": [{"fpl_percent": n, "official": f, "engine": e.applicable_figure(2026,n,False)} for n,f in entries.items() if abs(f-e.applicable_figure(2026,n,False)) > 1e-8]},
    "spouse_wages_error": {"profit":150000, "spouse_wages":80000, "engine_SE_tax":e.se_tax(h), "correct_SE_tax_with_zero_own_wages":150000*.9235*.153},
    "verified_2027_constants": {"ss_wage_base":192300, "defined_contribution_cap":75000, "source_ssa":"https://www.ssa.gov/cola/factsheets/2027.html", "source_irs":"https://www.irs.gov/pub/irs-drop/n-26-66.pdf"},
    "scenarios": rows,
}
(ROOT / "audit-results.json").write_text(json.dumps(output, indent=2), encoding="utf-8")
print(json.dumps({"table_mismatches":output["table_2026"]["mismatches"], "spouse_error":output["spouse_wages_error"], "scenarios":[{"scenario":r["scenario"],"two_year_cash_delta":round(r["cash_delta_two_tax_years"],2),"gross_retirement":r["gross_retirement_contribution"],"max_independent_cash_difference":max(abs(y["cash_difference"]) for y in r["years"])} for r in rows]}, indent=2))
