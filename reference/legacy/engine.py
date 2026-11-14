"""
CliffGuard reference engine, v2 (tax years 2026 and 2027).

Supported case (anything else raises UnsupportedCase):
  - single or married filing jointly, federal only (scenario states have no income tax)
  - Schedule C profit >= 0, optional W-2 wages and other MAGI income
  - full-year Marketplace coverage, no employer coverage offered, so the
    self-employed health insurance (SEHI) deduction is allowed
  - optional SEP-IRA contribution within the legal limit

PTC and the SEHI deduction depend on each other. IRS Pub. 974 allows any method
where (SEHI deduction + PTC computed with that deduction) <= premiums. The solver
therefore searches every allowed deduction and keeps the one with the most cash for
the household; `check_solution` re-verifies the answer by a separate code path.
"""

from dataclasses import dataclass, field
import math


class UnsupportedCase(ValueError):
    pass


# --------------------------------------------------------------- parameters --
YEARS = {
    2026: {
        # HHS 2025 poverty guidelines (used for 2026 coverage)
        "fpl_base": 15_650, "fpl_step": 5_500,
        # Rev. Proc. 2025-25 applicable percentage table (FPL from, to, start %, end %)
        "table": [(1.00, 1.33, 2.10, 2.10), (1.33, 1.50, 3.14, 4.19), (1.50, 2.00, 4.19, 6.60),
                  (2.00, 2.50, 6.60, 8.44), (2.50, 3.00, 8.44, 9.96), (3.00, 4.00, 9.96, 9.96)],
        # Rev. Proc. 2025-32
        "std": {"single": 16_100, "mfj": 32_200},
        "brackets": {"single": [(12_400, .10), (50_400, .12), (105_700, .22), (201_775, .24)],
                     "mfj": [(24_800, .10), (100_800, .12), (211_400, .22), (403_550, .24)]},
        "ss_wage_base": 184_500,   # SSA
        "ctc": 2_200,              # P.L. 119-21; 2027 release says "+$100 from 2026"
        "sep_cap": 72_000,         # Notice 2025-67 (IRC 415(c))
    },
    2027: {
        # HHS 2026 poverty guidelines (used for 2027 coverage): $15,960 + $5,680
        "fpl_base": 15_960, "fpl_step": 5_680,
        # Rev. Proc. 2026-26 (values from secondary summaries, verify against IRS PDF)
        "table": [(1.00, 1.33, 2.15, 2.15), (1.33, 1.50, 3.23, 4.30), (1.50, 2.00, 4.30, 6.78),
                  (2.00, 2.50, 6.78, 8.66), (2.50, 3.00, 8.66, 10.22), (3.00, 4.00, 10.22, 10.22)],
        # Rev. Proc. 2026-35
        "std": {"single": 16_600, "mfj": 33_200},
        "brackets": {"single": [(12_800, .10), (52_025, .12), (109_125, .22), (208_325, .24)],
                     "mfj": [(25_600, .10), (104_050, .12), (218_250, .22), (416_650, .24)]},
        "ss_wage_base": 184_500,   # 2026 value; 2027 not verified (irrelevant below it)
        "ctc": 2_300,              # Rev. Proc. 2026-35
        "sep_cap": 72_000,         # 2026 value; 2027 not verified (far above our cases)
    },
}

# Federal default standard age curve (CMS, plan years 2018+)
AGE_FACTOR = {0: 0.765, 28: 1.087, 35: 1.222, 38: 1.246, 39: 1.262, 40: 1.278, 44: 1.397}

# KFF State Health Facts, average monthly benchmark premium for a 40-year-old
KFF_BENCHMARK_40 = {2026: {"TX": 661, "FL": 683, "TN": 711}, 2027: {"TX": 737, "FL": 738, "TN": 796}}


def state_average_slcsp(year: int, state: str, ages: list[int]) -> float:
    """State-average benchmark scaled by age. NOT county-specific."""
    return sum(KFF_BENCHMARK_40[year][state] * AGE_FACTOR[a] / AGE_FACTOR[40] for a in ages) * 12


# ------------------------------------------------------------------ household --
@dataclass
class Household:
    year: int
    status: str                       # "single" | "mfj"
    size: int                         # tax family size
    children: int                     # qualifying children for the child tax credit
    se_profit: float                  # Schedule C net profit
    plan_premium: float               # annual premium of the enrolled plan
    slcsp: float                      # annual benchmark (SLCSP) premium for the family
    aptc_received: float = 0.0        # advance credit paid during the year
    wages: float = 0.0                # W-2 wages (e.g. spouse)
    other_income: float = 0.0         # other MAGI income (interest etc.)
    sep: float = 0.0                  # SEP-IRA contribution for this tax year
    enrollment_estimate_at_least_100: bool = True
    label: str = ""
    notes: list[str] = field(default_factory=list)


def p(year: int) -> dict:
    if year not in YEARS:
        raise UnsupportedCase(f"tax year {year} not supported")
    return YEARS[year]


def fpl_line(year: int, size: int) -> float:
    return p(year)["fpl_base"] + p(year)["fpl_step"] * (size - 1)


def se_tax(h: Household) -> float:
    earnings = max(0.0, h.se_profit) * 0.9235
    ss_room = max(0.0, p(h.year)["ss_wage_base"] - h.wages)
    return min(earnings, ss_room) * 0.124 + earnings * 0.029


def fica(h: Household) -> float:
    return min(h.wages, p(h.year)["ss_wage_base"]) * 0.062 + h.wages * 0.0145


def max_sep(h: Household) -> float:
    """Pub. 560: owner's rate on net earnings after half SE tax -> effectively 20%."""
    return min(p(h.year)["sep_cap"], 0.2 * max(0.0, h.se_profit - se_tax(h) / 2))


def validate(h: Household) -> None:
    if h.status not in ("single", "mfj"):
        raise UnsupportedCase("filing status must be single or mfj")
    if h.size < (2 if h.status == "mfj" else 1) or h.children > h.size:
        raise UnsupportedCase("household size inconsistent with status/children")
    if h.se_profit < 0:
        raise UnsupportedCase("Schedule C losses are not supported")
    for name in ("plan_premium", "slcsp"):
        if getattr(h, name) <= 0:
            raise UnsupportedCase(f"{name} must be positive")
    for name in ("aptc_received", "wages", "other_income", "sep"):
        if getattr(h, name) < 0:
            raise UnsupportedCase(f"{name} cannot be negative")
    if h.sep > max_sep(h) + 0.5:
        raise UnsupportedCase(f"SEP {h.sep:,.0f} exceeds the limit {max_sep(h):,.0f}")


# ------------------------------------------------------------ Form 8962 core --
def line5_percent(year: int, size: int, household_income: float) -> int:
    """Worksheet 2: >4x FPL -> 401, else truncate (do not round)."""
    line4 = fpl_line(year, size)
    if household_income > 4 * line4:
        return 401
    return math.floor(household_income / line4 * 100)


def applicable_figure(year: int, line5: int, below_100_ok: bool) -> float | None:
    """Table 2 value as a 4-decimal fraction; None = not an applicable taxpayer."""
    if line5 > 400:
        return None
    pct = line5 / 100
    table = p(year)["table"]
    if pct < 1.0:
        if not below_100_ok:
            return None
        return round(table[0][2] / 100, 4)
    for lo, hi, start, end in table:
        last = hi == table[-1][1]
        if lo <= pct < hi or (last and pct <= hi):
            frac = 0.0 if hi == lo else (pct - lo) / (hi - lo)
            return round((start + (end - start) * frac) / 100, 4)
    return None


def ptc_for_income(h: Household, household_income: float) -> float:
    line5 = line5_percent(h.year, h.size, household_income)
    below_ok = h.aptc_received > 0 and h.enrollment_estimate_at_least_100
    fig = applicable_figure(h.year, line5, below_ok)
    if fig is None:
        return 0.0
    contribution = round(household_income * fig)          # line 8a
    return max(0.0, min(h.plan_premium, h.slcsp - contribution))


# ------------------------------------------------------------------- tax core --
def income_tax(year: int, status: str, taxable: float) -> float:
    tax, prev = 0.0, 0.0
    for top, rate in p(year)["brackets"][status]:
        if taxable > prev:
            tax += (min(taxable, top) - prev) * rate
        prev = top
    if taxable > prev:
        tax += (taxable - prev) * 0.32
    return tax


def evaluate(h: Household, sehi: float) -> dict:
    """Everything that follows from one choice of SEHI deduction."""
    half_se = se_tax(h) / 2
    magi = h.se_profit + h.wages + h.other_income - half_se - h.sep - sehi
    ptc = ptc_for_income(h, magi)
    agi = magi
    qbi = max(0.0, h.se_profit - half_se - h.sep - sehi)
    taxable_before_qbi = max(0.0, agi - p(h.year)["std"][h.status])
    taxable = taxable_before_qbi - 0.2 * min(qbi, taxable_before_qbi)
    inc_tax = max(0.0, income_tax(h.year, h.status, taxable) - p(h.year)["ctc"] * h.children)
    taxes = 2 * half_se + fica(h) + inc_tax
    cash = h.se_profit + h.wages + h.other_income - taxes - (h.plan_premium - ptc) - h.sep
    return {"sehi": sehi, "magi": magi, "ptc": ptc, "income_tax": inc_tax,
            "se_tax": 2 * half_se, "fica": fica(h), "taxes": taxes, "cash": cash}


def max_sehi(h: Household) -> float:
    return max(0.0, min(h.plan_premium, h.se_profit - se_tax(h) / 2 - h.sep))


def allowed(h: Household, r: dict) -> bool:
    return r["sehi"] <= max_sehi(h) + 0.01 and r["sehi"] + r["ptc"] <= h.plan_premium + 0.5


def solve(h: Household) -> dict:
    validate(h)
    top = int(max_sehi(h))
    best = None
    for d in list(range(0, top + 1, 10)) + [top]:           # coarse pass
        r = evaluate(h, float(d))
        if allowed(h, r) and (best is None or r["cash"] > best["cash"] + 1e-9):
            best = r
    lo, hi = max(0, int(best["sehi"]) - 10), min(top, int(best["sehi"]) + 10)
    for d in range(lo, hi + 1):                               # refine by $1
        r = evaluate(h, float(d))
        if allowed(h, r) and r["cash"] > best["cash"] + 1e-9:
            best = r
    best = dict(best)
    best.update({
        "label": h.label, "year": h.year, "sep": h.sep,
        "fpl_pct": line5_percent(h.year, h.size, best["magi"]),
        "cliff": 4 * fpl_line(h.year, h.size),
        "owe_april": h.aptc_received - best["ptc"],
    })
    return best


# ---------------------------------------------------------- independent check --
def check_solution(h: Household, r: dict, grid_step: int = 50) -> list[str]:
    """Re-verify a result without using the solver: constraints, Form 8962 math,
    and a coarse brute-force search that no allowed deduction gives more cash."""
    problems = []
    half_se = se_tax(h) / 2
    magi = h.se_profit + h.wages + h.other_income - half_se - h.sep - r["sehi"]
    if abs(magi - r["magi"]) > 0.5:
        problems.append("MAGI mismatch")
    line4 = fpl_line(h.year, h.size)
    line5 = 401 if magi > 4 * line4 else math.floor(magi / line4 * 100)
    fig = applicable_figure(h.year, line5, h.aptc_received > 0 and h.enrollment_estimate_at_least_100)
    expected_ptc = 0.0 if fig is None else max(0.0, min(h.plan_premium, h.slcsp - round(magi * fig)))
    if abs(expected_ptc - r["ptc"]) > 0.5:
        problems.append("PTC does not match Form 8962 math")
    if r["sehi"] + r["ptc"] > h.plan_premium + 0.5:
        problems.append("SEHI + PTC exceeds premiums (Pub. 974)")
    if r["sehi"] > max_sehi(h) + 0.01:
        problems.append("SEHI exceeds earned-income limit")
    for d in range(0, int(max_sehi(h)) + 1, grid_step):
        alt = evaluate(h, float(d))
        if allowed(h, alt) and alt["cash"] > r["cash"] + 1.0:
            problems.append(f"better allowed deduction exists at {d}")
            break
    return problems
