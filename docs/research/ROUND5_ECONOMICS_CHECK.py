"""Reproducible scenario arithmetic for ROUND5_BUSINESS_RESEARCH.md.
Rates are observed list prices; usage, support, refunds and retention are hypotheses.
No network access, advertising, billing or user data.
"""
from decimal import Decimal as D
from pathlib import Path
import json
from math import ceil

def price(value):
    return D(str(value))

def display(value):
    if isinstance(value, D):
        return float(value)
    if isinstance(value, dict):
        return {key: display(item) for key, item in value.items()}
    if isinstance(value, list):
        return [display(item) for item in value]
    return value

input_rate = D('0.30') / 1000000
output_rate = D('2.50') / 1000000
doc_cost = 30000 * input_rate + 3000 * output_rate
update_cost = 8000 * input_rate + 1500 * output_rate
base_infra_year = D(540)

def model(gross, recurring, documents, updates, support_minutes, billings, doc_unit=doc_cost, update_unit=update_cost):
    gross = price(gross)
    ai = 2 * (documents * doc_unit + updates * update_unit)
    fees = gross * (D('.029') + (D('.007') if recurring else D(0))) + D('.30')
    net_revenue = gross * D('.97')
    support = price(support_minutes) * D(30) / 60
    infra = base_infra_year / price(billings)
    variable_contribution = net_revenue - ai - fees - support
    cm = variable_contribution - infra
    return dict(gross=gross, net_revenue=net_revenue, processing_and_billing=fees,
                ai=ai, support=support, infra=infra, variable_contribution=variable_contribution,
                contribution=cm, contribution_margin=cm / net_revenue)

products = {
    'decision_29': model(29, False, 2, 4, 10, 1000),
    'season_49': model(49, False, 5, 10, 15, 1000),
    'annual_99': model(99, True, 20, 40, 20, 1000),
    'monthly_15': model(15, True, 2, 4, 5, 12000),
}
assert products['annual_99']['contribution'] == D('80.474')
assert products['monthly_15']['contribution'] == D('11.0498')
assert products['decision_29']['contribution'] == D('21.3338')
assert products['season_49']['contribution'] == D('37.481')
annual_cm = products['annual_99']['contribution']
monthly_cm = products['monthly_15']['contribution']

def cohort_ltv(cm, churn, periods):
    return cm * (1 - (1 - churn) ** periods) / churn

def cohort_payback(cm, churn, cac, max_periods=120):
    for n in range(1, max_periods + 1):
        if cohort_ltv(cm, churn, n) >= cac:
            return n
    return None

monthly = {}
for c in (D('.10'), D('.15'), D('.25')):
    monthly[str(c)] = dict(expected_billed_months=1 / c, infinite_ltv=monthly_cm / c,
                          ltv_12=cohort_ltv(monthly_cm, c, 12),
                          cac_ceiling_3_to_1_12mo=cohort_ltv(monthly_cm, c, 12) / 3,
                          cohort_payback_cac25=cohort_payback(monthly_cm, c, D(25)),
                          cohort_payback_cac40=cohort_payback(monthly_cm, c, D(40)))

anthropic = {}
for name, in_mtok, out_mtok in (('claude-opus-5-5',D(4),D(20)),
                                ('claude-sonnet-5-5',D(2),D(10)),
                                ('claude-haiku-5-5-under-100k',D('.10'),D('.50'))):
    doc = (30000*in_mtok+3000*out_mtok)/1000000
    update = (8000*in_mtok+1500*out_mtok)/1000000
    prof = {
        'decision_29':model(29,False,2,4,10,1000,doc,update),
        'season_49':model(49,False,5,10,15,1000,doc,update),
        'annual_99':model(99,True,20,40,20,1000,doc,update),
        'monthly_15':model(15,True,2,4,5,12000,doc,update),
    }
    acm=prof['annual_99']['contribution']
    mcm=prof['monthly_15']['contribution']
    anthropic[name] = dict(input_mtok=in_mtok,output_mtok=out_mtok,document=doc,update=update,
        products=prof,annual_cac_ceiling_no_renewal=acm/3,
        annual_ltv_3yr_at_60pct=acm*D('1.96'),annual_cac_ceiling_3yr=acm*D('1.96')/3,
        monthly_ltv_12_at_15pct=cohort_ltv(mcm,D('.15'),12),
        monthly_cac_ceiling_12_at_15pct=cohort_ltv(mcm,D('.15'),12)/3,
        free_document_with_retry=doc*2,free_ai_per_payer_at_5pct=doc*2/D('.05'))
assert anthropic['claude-opus-5-5']['products']['annual_99']['ai']==D('12.16')
assert anthropic['claude-opus-5-5']['products']['annual_99']['contribution']==D('69.466')

annual_ltv_3 = annual_cm * (1 + D('.6') + D('.6') ** 2)
sens_support = {str(m): model(99, True, 20, 40, m, 1000)['contribution'] for m in (10,20,60,120)}
sens_scale = {str(n): model(99, True, 20, 40, 20, n)['contribution'] for n in (10,100,1000,10000)}
som = []
for clicks, conversion, cpc in ((3000,D('.02'),D(1)), (5000,D('.05'),D(1)), (10000,D('.08'),D('1.5'))):
    payers = price(clicks) * conversion
    revenue = payers * 99
    media = price(clicks) * cpc
    # Fixed cost charged once to the cohort; never keep N=1000 allocation for smaller cohorts.
    contribution_after_media_and_fixed = payers * anthropic['claude-opus-5-5']['products']['annual_99']['variable_contribution'] - base_infra_year - media
    som.append(dict(clicks=clicks, conversion=conversion, cpc=cpc, unique_payers=payers,
                    revenue=revenue, media=media, media_cac=media/payers,
                    contribution_after_media_and_fixed=contribution_after_media_and_fixed))

result = {
    'date_checked': '2026-11-15',
    'unit': 'USD; hypothetical economics, not observed customer performance',
    'base_architecture_note': 'products/annual/monthly below use alternative Gemini3.5FlashLite; existing adapter default AnthropicOpus5.5 is modeled under anthropic_profiles; SOM uses Opus5.5; productionAIoff',
    'anthropic_pricing_source': 'https://platform.claude.com/docs/en/about-claude/pricing',
    'reference_profile_for_current_adapter': 'claude-opus-5-5',
    'anthropic_profiles': anthropic,
    'ai': {'document': doc_cost, 'update': update_cost, 'retry_multiplier': 2,
           'free_document_with_retry': doc_cost*2, 'free_ai_per_payer_at_5pct': doc_cost*2/D('.05')},
    'products': products,
    'annual': {'renewal_hypothesis': D('.6'), 'three_year_ltv': annual_ltv_3,
               'three_year_cac_ceiling': annual_ltv_3/3,
               'no_renewal_cac_ceiling': annual_cm/3,
               'infinite_ltv_diagnostic_only': annual_cm/D('.4')},
    'season': {'two_season_ltv_at_40pct_repurchase': products['season_49']['contribution'] * D('1.4'),
               'two_season_cac_ceiling': products['season_49']['contribution'] * D('1.4')/3,
               'single_season_cac_ceiling': products['season_49']['contribution']/3},
    'decision_cac_ceiling': products['decision_29']['contribution']/3,
    'monthly': monthly,
    'annual_support_sensitivity': sens_support,
    'annual_scale_sensitivity': sens_scale,
    'annual_ai_10x_contribution': annual_cm - 9*products['annual_99']['ai'],
    'cac_grid': {str(cpc): {str(cr): cpc/cr for cr in (D('.02'),D('.05'),D('.10'))}
                 for cpc in (D('.5'),D(1),D(2),D(5))},
    'som_scenarios': som,
    'irs': {'tax2025_partial_repayment_returns': 6131638,
             'tax2025_partial_repayment_usd': 8186288000,
             'tax2025_partial_average_usd': D(8186288000)/6131638,
             'tax2024_nov_repayment_returns': 6391741,
             'tax2024_nov_average_usd': D(8812506000)/6391741,
             'tax2025_partial_aptc_returns': 11159789},
    'market': {'cms_three_state_300_500_fpl_people': 215101+40777+199571,
               'treasury_three_state_people': 423790+618590+66270,
               'hypothetical_all_aptc_returns_times99_not_tam': 11159789*99,
               'household_subscriptions_for_100m_arr_at99': ceil(100000000/99)},
    'zero_purchases_100_trials_one_sided_95pct_upper': 1 - .05**(1/100),
}
target = Path(__file__).with_name('ROUND5_ECONOMICS_CHECK.json')
target.write_text(json.dumps(display(result), indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps(display(result), indent=2, ensure_ascii=False))
