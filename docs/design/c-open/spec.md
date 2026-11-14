# Headroom C — selected visual specification
**Status: user-selected art direction, not implemented UI.** 15 November 2026. The authoritative [selected home reference](01-home-selected.png) is a byte-identical copy of the user-selected `C-open.png`; its SHA-256 is recorded in `assets.json`. This specification supersedes the withdrawn green/beige/serif proposal. Existing financial and round-5 functional requirements remain binding.

## The composition to preserve
C uses a saturated cobalt stage, a short centered statement, a chrome object derived from the concave H, a chartreuse plane and a wide white entry tray crossing into the white page below. Its identity comes from those proportions and materials together, not a new coat of blue on the former layout.

Hero copy: **“Before you say yes.”** Supporting line: **“See what a client offer leaves you after tax and health insurance.”** Primary action: **“Check my offer”**. Keep the offer entry as live HTML. Add document, manual entry and the live example remain usable alternatives; the current-year income check stays available without inventing an offer. No signup gate.

The hero scene may contain the illustrative $12,000 offer shown in C. It must not invent an outcome. In the actual demo use one persistent “Synthetic example” context label. Put relevant conditions beside their affected result/row; do not make the public hero a wall of tax caveats.

After entry, the experience becomes **predominantly white / cool light gray**: cobalt navigation and selected result; chartreuse primary action; clear ink text. Keep the chrome scene on the landing page. No shiny form fields, gradient text, neon entire-workspace backgrounds or decorative graphs.

Included image integration assets (same directory): `01-home-selected.png` (unchanged C), `02-review-desktop.png`, `03-result-desktop.png`, `04-result-mobile.png`, `05-hero-scene.png`. Screens are design references; the isolated scene is decorative material. Never embed a full screen PNG as the working page.

## Identity and type
Use [headroom-mark.svg](headroom-mark.svg), a hand-authored single filled path implementing the selected compact concave H/hourglass. It uses `currentColor`, has no background or embedded raster, and is transparent. Normal: ink/cobalt on white. Inverse: white on cobalt. It is not a texture trace and no trademark clearance is claimed. It has been rendered and visually inspected at 16/24/32/64/128px in both modes; [logo-proof.png](logo-proof.png) is the proof.

Keep the mark beside the lowercase wordmark, with a gap about 0.35× mark height. Typical mark height 28px desktop / 24px mobile. Use Geist Sans 700 for the wordmark initially, with optical spacing; adjacent brand text makes the symbol decorative (`aria-hidden`), while the home link has an accessible name.

**One family: Geist Sans.** Bold display and precise readable UI belong to the same system. Do not introduce serif or monospace for ordinary money. Vercel's [official repository](https://github.com/vercel/geist-font) identifies the family and its [OFL 1.1 license](https://github.com/vercel/geist-font/blob/main/OFL.txt) permits embedding under its conditions. Self-host an approved WOFF2 build, retain copyright/OFL, use `font-display: swap`; preload only the normal variable face used above the fold. The PNG is not proof of a font binary. Real text wrapping must be checked after loading Geist.

| Role | Desktop | 360px | Weight |
|---|---|---|---|
| Hero | 88px / 0.98; −0.045em | 42px / 1.02 | 750 |
| Hero supporting line | 24px / 1.35 | 18px / 1.4 | 400 |
| App title | 36px / 40px | 28px / 32px | 700 |
| Section heading | 24px / 30px | 22px / 28px | 650 |
| Primary result | 64px / 1 | 48px / 1.05 | 650 |
| Body/input | 16px / 24px | 16px / 24px | 400 |
| Labels/secondary | 14px / 20px | 14px / 20px | 600/400 |
| Metadata only | 12px / 18px | 12px / 18px | 400 |
| Buttons | 16px / 20px | 16px / 20px | 650 |

Use `tabular-nums lining-nums` for amounts, align numeric columns, retain explicit +/− signs and full dates. Material conditions, validation and cash-horizon labels are at least 14px. Do not abbreviate a decisive amount to “9.7K”. The display scale belongs to the hero and main result, not every card heading.

## Color and structure
Exact tokens and measured pairs: [tokens.json](tokens.json).

- Cobalt **#2447F0**: brand stage, nav, selected result and links. White on cobalt **6.49:1**.
- Chartreuse **#DFFF74**: primary action and small compositional accents. Ink **#10131C** on chartreuse **16.51:1**. Never white text on chartreuse.
- White **#FFFFFF**, canvas **#F4F6FB**, ink **#10131C**; muted **#586176** on canvas **5.74:1**.
- Form boundary **#7A8498** on white **3.76:1**. Decorative divider **#DCE1EC** is **1.31:1**, unsuitable as the only interactive boundary.
- Amber text/fill **#875000 / #FFF0D5**: uncertainty, **5.88:1**. Red **#B4233B / #FFF0F1**: actual error/negative change, **5.85:1**. Success **#156347 / #E9F7EE**, **6.54:1**.
- Lime button on white receives a **#71851D** boundary (**4.14:1** against white). Selection color never means financially safe.
- Disabled text/fill **#687186 / #E2E6F0** is **3.91:1**: disabled controls only, never active explanatory copy.

Maximum page width 1280px; working content 1200px. Gutters 48/32/20px desktop/tablet/mobile. Use 4/8/12/16/24/32/48/64/80/112 spacing steps. Desktop grid gap 24px; mobile 16px. Radius: control 12px, content 20px, landing tray 24px. One subtle tray shadow; no shadow on every fact or comparison row.

Hero: headline above object, scene center roughly 900–1000px wide, entry tray up to 1120px wide overlapping the blue/white boundary. Position the tray in document flow; negative margin is allowed, fixed height/clipped text is not. Below 800px: header simplifies; heading becomes two lines naturally; put entry before the decorative scene in reading order and visible priority. Scene can be smaller or cropped as decoration. Keep full input and CTA visible without horizontal scrolling.

## States and motion
Primary action: ink on lime; hover #D3F65E, active #C6EB4F; 120ms color/border. Secondary: ink/cobalt outline. Selected comparison: cobalt plus text/radio indication, not just color. Pending facts are unselected. Error is associated with its field and leaves entered content intact.

Focus on light surfaces: 3px cobalt ring + 3px gap. On cobalt surfaces: 3px chartreuse ring + 3px gap (chartreuse/cobalt **5.78:1**). Targets ≥44×44 CSS px; normal inputs/buttons 48px, hero CTA 56px. Do not substitute opacity for a real disabled state.

Disclosure 180ms; panel 220ms; maximum UI translation 8px; easing `cubic-bezier(0.22,1,0.36,1)`. Optional scene entrance ≤450ms once, never blocking entry. Changed row can tint for 600ms while persistent before/after text remains. No looping chrome rotation, parallax, fake processing percentages or money countups. With reduced motion: remove transforms and smooth scrolling, use immediate state or ≤80ms opacity; static scene is the valid default.

Keyboard order follows reading order. Native form labels, radio groups and buttons; errors linked to inputs; focus restored after drawers; Escape closes overlays. Sticky mobile CTA cannot obscure content/focus. Check actual 360px and 200% zoom; support narrow reflow without page-level horizontal scrolling. Generated images have not passed DOM accessibility or responsive testing.
