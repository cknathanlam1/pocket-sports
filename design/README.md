# /design — Claude Design export (read-only reference)

Not yet imported. Source project:
https://claude.ai/design/p/3f12181e-90f3-4993-8c1f-fcfdcdd14011?file=Splash+Rally+Design.dc.html

Expected contents once exported:
- `Splash Rally Design.dc.html`
- `_ds/ensembl-design-system-794f4091-e668-4678-87a1-6291c32d7e06/tokens/colors.css`
- `_ds/ensembl-design-system-794f4091-e668-4678-87a1-6291c32d7e06/tokens/fonts.css`
- `support.js`

After import, `shared/styles/tokens.css` should `@import` (or copy) the token files above
instead of its placeholder values.
