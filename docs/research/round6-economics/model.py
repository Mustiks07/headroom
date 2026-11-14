"""Finite, reproducible monetization scenarios. No network, billing or customer data.
Run: python docs/research/round6-economics/model.py
This is a business model, separate from the customer financial engine.
"""
from pathlib import Path
from decimal import Decimal as D
from math import ceil
import json

ROOT = Path(__file__).resolve().parent
data = json.loads((ROOT / 'inputs.json').read_text(encoding='utf-8'), parse_float=D, parse_int=D)
a, rates = data['assumptions'], data['observed_prices']
assert D(0) <= a['full_refund_rate'] <= D(1), 'Refund rate must be in [0, 1]'
assert all(D(0) <= x <= D(1) for key in ['annual_renewal_scenarios','monthly_churn_scenarios','single_repeat_purchase_probabilities'] for x in a[key]), 'Retention probabilities must be in [0, 1]'
assert all(value >= 0 for value in rates.values()), 'Rates cannot be negative'
assert all(p[key] >= 0 for p in data['products'].values() for key in ['price','documents','updates','support_minutes','variable_infra']), 'Product amounts cannot be negative'
doc = a['token_reserve_multiplier'] * (a['document_input_tokens'] * rates['opus_input_per_million'] + a['document_output_tokens'] * rates['opus_output_per_million']) / D(1000000)
update = a['token_reserve_multiplier'] * (a['update_input_tokens'] * rates['opus_input_per_million'] + a['update_output_tokens'] * rates['opus_output_per_million']) / D(1000000)

def product(p, *, refund=None, usage=D(1), support_minutes=None, mor=False):
    refund = a['full_refund_rate'] if refund is None else refund
    support_minutes = p['support_minutes'] if support_minutes is None else support_minutes
    gross = p['price']
    net = gross * (1-refund)
    fee = gross * (rates['stripe_domestic_card_pct'] + (rates['stripe_billing_pct'] if p['recurring'] else 0)) + rates['stripe_per_charge']
    if mor:
        fee = gross * rates['mor_comparison_pct'] + rates['mor_comparison_per_charge']
    ai = usage * (p['documents'] * doc + p['updates'] * update)
    support = support_minutes * a['support_hourly_usd'] / 60
    delivery = ai + support + p['variable_infra']
    cm = net - fee - delivery
    return dict(gross=gross, expected_net_collections=net, processing_billing=fee,
                ai=ai, support=support, variable_infra=p['variable_infra'],
                service_cost_reserve=delivery, contribution_before_cac_fixed=cm,
                contribution_fraction_of_net=cm/net if net else None,
                one_period_cac_budget_at_3x=cm/a['planning_contribution_cac_ratio'])

products = {k: product(v) for k, v in data['products'].items()}
f = data['funnel']
assert all(D(0) < f[key] <= D(1) for key in ['eligible_share','complete_given_eligible','buy_given_complete']), 'Funnel probabilities must be in (0, 1]'
assert f['visitors'] > 0 and f['cpc_usd'] >= 0 and f['acquisition_labor_total_usd'] >= 0
paid_share = f['eligible_share'] * f['complete_given_eligible'] * f['buy_given_complete']
payers = f['visitors'] * paid_share
acquisition = {}
for name, ai_share in [('before_qualification', D(1)), ('after_qualification', f['eligible_share'])]:
    # All payers in this scenario consumed one intake; it is already in paid COGS.
    assert paid_share <= ai_share
    nonpayer_intakes = f['visitors'] * (ai_share-paid_share)
    nonpayer_ai = nonpayer_intakes * f['free_ai_document_per_person'] * doc
    media = f['visitors'] * f['cpc_usd']
    labor = f['acquisition_labor_total_usd']
    total = media + nonpayer_ai + labor
    acquisition[name] = dict(visitors=f['visitors'], payers=payers, visitor_to_paid=paid_share,
        media=media, nonpayer_ai=nonpayer_ai, labor=labor, cac=total/payers,
        annual99_first_period_contribution_to_cac=products['annual99']['contribution_before_cac_fixed']/(total/payers))

def ltv(cm, survival, periods, onboarding=D(0)):
    weight, contribution = D(1), -onboarding
    for _ in range(periods):
        contribution += cm * weight
        weight *= survival
    return contribution

annual = {}
acac = acquisition['after_qualification']['cac']
for r in a['annual_renewal_scenarios']:
    cm = products['annual99']['contribution_before_cac_fixed']
    contribution = ltv(cm, r, 3)
    annual[str(r)] = dict(renewal_probability=r, contribution_ltv_36_months=contribution,
        ltv_to_modeled_cac=contribution/acac, cumulative_billing_periods=D(1)+r+r*r,
        cac_budget_3x=contribution/3)

monthly = {}
onboarding = a['monthly_onboarding_minutes_once'] * a['support_hourly_usd'] / 60
mcm = products['monthly15_test']['contribution_before_cac_fixed']
for churn in a['monthly_churn_scenarios']:
    survival = 1-churn
    payback = next((n for n in range(1,37) if ltv(mcm,survival,n,onboarding) >= acac), None)
    monthly[str(churn)] = dict(churn=churn, survival_after_12_renewal_opportunities=survival**12,
        expected_paid_months_first_12=ltv(D(1),survival,12),
        contribution_ltv_12=ltv(mcm,survival,12,onboarding),
        contribution_ltv_36=ltv(mcm,survival,36,onboarding),
        cohort_payback_billing_period=payback)

repeat = {k:{str(r):products[k]['contribution_before_cac_fixed']*(1+r) for r in a['single_repeat_purchase_probabilities']} for k in ['case29','season49']}
annual_plan=data['products']['annual99']
stress = {
    'base': product(annual_plan),
    'refund_10pct': product(annual_plan,refund=D('.10')),
    'support_60min': product(annual_plan,support_minutes=D(60)),
    'ai3x_support60': product(annual_plan,usage=D(3),support_minutes=D(60)),
    'ai5x_support120': product(annual_plan,usage=D(5),support_minutes=D(120)),
    'mor_fee_comparison': product(annual_plan,mor=True)
}
conv_sensitivity={}
for p in [D('.01'),D('.02'),D('.036'),D('.05'),D('.10')]:
    # q is fixed; all payers qualified and had the first paid-COGS intake.
    cac = (f['cpc_usd']+doc*(f['eligible_share']-p)+f['acquisition_labor_total_usd']/f['visitors'])/p
    conv_sensitivity[str(p)] = dict(cac=cac, contribution_to_cac=products['annual99']['contribution_before_cac_fixed']/cac)
target=products['annual99']['contribution_before_cac_fixed']/3
min_p=(f['cpc_usd']+doc*f['eligible_share']+f['acquisition_labor_total_usd']/f['visitors'])/(target+doc)
cm=products['annual99']['contribution_before_cac_fixed']
business={}
for fixed in [D(540),D(12000),D(120000)]:
    # First-year all-new customers; no imaginary repeat renewals subsidize CAC.
    business[str(fixed)] = dict(fixed_annual=fixed, first_year_new_annual_buyers_to_cover=ceil(fixed/(cm-acac)))

out=dict(status=data['status'],checked_date=data['checked_date'],
         reserved_document_cost=doc,reserved_update_cost=update,
         products=products,acquisition=acquisition,annual_cohorts=annual,monthly_cohorts=monthly,
         one_extra_purchase_in_12_months=repeat,annual99_stress=stress,
         conversion_sensitivity=conv_sensitivity,min_visitor_to_paid_first_year_3x=min_p,
         price149_vs99_equal_contribution_conversion_ratio=cm/products['annual149_test']['contribution_before_cac_fixed'],
         annual99_uniform_service_cost_adjusted_earned_payback_months=acac/(cm/12),
         first_year_break_even=business,
         scale=dict(annual99_active_households_for_100m_arr=ceil(D(100000000)/99),
                    annual149_active_households_for_100m_arr=ceil(D(100000000)/149),
                    monthly15_active_households_for_100m_arr=ceil(D(100000000)/(15*12)),
                    case29_sales_for_100m_nonrecurring_revenue=ceil(D(100000000)/29),
                    season49_sales_for_100m_nonrecurring_revenue=ceil(D(100000000)/49)))

# Bounded arithmetic checks target accounting mistakes, not implementation coverage.
assert doc == D('.36') and update == D('.124')
assert products['annual99']['ai'] == D('12.16')
assert products['annual99']['contribution_before_cac_fixed'] == D('66.526')
assert products['case29']['contribution_before_cac_fixed'] == D('19.943')
assert product(annual_plan,refund=D(1))['contribution_before_cac_fixed'] < 0
assert product(annual_plan,refund=D(1))['processing_billing'] == products['annual99']['processing_billing']
assert acquisition['before_qualification']['nonpayer_ai'] - acquisition['after_qualification']['nonpayer_ai'] == f['visitors']*(1-f['eligible_share'])*doc
assert ltv(D(10),D(0),12,D(5)) == D(5)
assert ltv(D(10),D(1),12,D(5)) == D(115)
assert ltv(D(10),D('.5'),3) == D('17.5')

def serial(x):
    if isinstance(x,D): return round(float(x),8)
    if isinstance(x,dict): return {k:serial(v) for k,v in x.items()}
    return x

(ROOT/'results.json').write_text(json.dumps(serial(out),indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
rows=['# Monetization model — calculated scenarios','',
      '**Hypotheses, not measured customers.** USD; checked 2026-11-15. Change `inputs.json`, run `python docs/research/round6-economics/model.py`. One product period; contribution excludes CAC and fixed costs.','',
      '| Product | Price | Net after assumed refunds | Payment fees | AI | Support | Variable infra | Contribution |',
      '|---|---:|---:|---:|---:|---:|---:|---:|']
for k,p in products.items():
    vals=[p[v] for v in ['gross','expected_net_collections','processing_billing','ai','support','variable_infra','contribution_before_cac_fixed']]
    rows.append('| '+k+' | '+' | '.join(f'{v:.2f}' for v in vals)+' |')
rows += ['',f'Qualified-first acquisition scenario: {paid_share:.2%} visitor-to-paid; fully stated CAC ${acac:.2f}; annual99 first-period contribution/CAC {cm/acac:.2f}×.',
         f'For the chosen first-period 3× target, visitor-to-paid must reach {min_p:.2%} at the same assumed CPC, qualification and labor costs. This is a required threshold, not a predicted conversion.',
         '', '| Annual renewal assumption | 36-month contribution LTV | Ratio to modeled CAC |', '|---|---:|---:|']
for k,p in annual.items(): rows.append(f"| {float(k):.0%} | ${p['contribution_ltv_36_months']:.2f} | {p['ltv_to_modeled_cac']:.2f}× |")
rows += ['', '| Monthly churn assumption | 12-month contribution LTV | 36-month contribution LTV | Payback billing period |', '|---|---:|---:|---:|']
for k,p in monthly.items(): rows.append(f"| {float(k):.0%} | ${p['contribution_ltv_12']:.2f} | ${p['contribution_ltv_36']:.2f} | {p['cohort_payback_billing_period'] or 'not reached within 36'} |")
rows += ['', '| Annual99 sensitivity | Contribution before CAC/fixed |','|---|---:|']
for k,p in stress.items(): rows.append(f"| {k} | ${p['contribution_before_cac_fixed']:.2f} |")
rows += ['', 'Limitations:', '']+['- '+s for s in data['limitations']]
(ROOT/'summary.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
print('PASS: accounting checks; generated results.json and summary.md. No external actions.')
