"""Additional hypothetical arithmetic for HEADROOM_PAID_VALUE_STRATEGY.md.
Reuses the dated Opus profile from ROUND5_ECONOMICS_CHECK.json.
No advertising, payments, network or customer data. Run with Python 3.
"""
from decimal import Decimal as D
from pathlib import Path
import json

root = Path(__file__).parent
prior = json.loads((root / 'ROUND5_ECONOMICS_CHECK.json').read_text(encoding='utf-8-sig'), parse_float=D)
profile = prior['anthropic_profiles']['claude-opus-5-5']
contribution = {k: v['contribution'] for k, v in profile['products'].items()}
free_doc = profile['free_document_with_retry']

# The first document of a payer is already inside paid COGS.
# Add acquisition AI for non-payers only, avoiding double counting.
def acquisition(cpc, paid_rate, free_nonpayer_doc_rate=D(1)):
    media = D(str(cpc)) / D(str(paid_rate))
    p = D(str(paid_rate))
    acquisition_ai = free_doc * free_nonpayer_doc_rate * (1 - p) / p
    return {'media_cac': media, 'nonpayer_ai_cac': acquisition_ai, 'total_before_labor': media + acquisition_ai}

results = {
    'status': 'hypotheses, not customer measurements',
    'checked_date': '2026-11-15',
    'source': 'ROUND5_ECONOMICS_CHECK.json / anthropic_profiles / claude-opus-5-5',
    'contribution': contribution,
    'single_period_cac_target_3_to_1': {k: v / 3 for k, v in contribution.items()},
    'annual_support_minutes': {str(m): contribution['annual_99'] + D(10) - D(m) * D('.5') for m in (10, 20, 60, 120)},
    'acquisition_cpc_1': {str(p): acquisition(1, p) for p in (D('.02'), D('.05'), D('.10'), D('.20'))},
    # If every nonpayer uses one free document, solve 1.36/p - .36 <= contribution/3.
    'min_visitor_to_paid_at_cpc1_and_free_doc_no_labor': {
        k: (D(1) + free_doc) / (v / 3 + free_doc)
        for k, v in contribution.items() if k != 'monthly_15'
    },
    'funnel_example': {'eligible': D('.30'), 'complete_given_eligible': D('.60'), 'paid_given_complete': D('.20')},
    'one_additional_purchase_probability_40pct': {
        k: v * D('1.4') for k, v in contribution.items() if k in ('decision_29', 'season_49')
    },
    'annual_three_period_ltv_60pct_renewal': contribution['annual_99'] * D('1.96'),
    'hundred_million_revenue_units': {'decision29_transactions': D(100000000)/29,
                                   'season49_purchases': D(100000000)/49,
                                   'annual99_households': D(100000000)/99},
    'zero_sales_one_sided_95pct_upper': {str(n): 1 - .05 ** (1 / n) for n in (30, 60, 100)},
}
f = results['funnel_example']
f['visitor_to_paid'] = f['eligible'] * f['complete_given_eligible'] * f['paid_given_complete']
f['media_cac_at_cpc1'] = D(1)/f['visitor_to_paid']
assert contribution['annual_99'] == D('69.466')
assert acquisition(1,D('.05'))['total_before_labor'] == D('26.84')
assert f['visitor_to_paid'] == D('.0360')

def serial(x):
    if isinstance(x, D): return float(x)
    if isinstance(x, dict): return {k: serial(v) for k, v in x.items()}
    return x

out = serial(results)
(root / 'HEADROOM_PAID_VALUE_ECONOMICS_CHECK.json').write_text(json.dumps(out, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
print(json.dumps(out, ensure_ascii=False, indent=2))
