# FTU Hints — Status (WIP)

*Last updated: 2026-03-24*
*Latest committed: `b36815d` (dev)*

## Implemented

Six coordinated hints guide new users through progressive discovery:

| # | Hint | Trigger | Animation | Cleared By | localStorage Key |
|---|---|---|---|---|---|
| 1 | **Status dot pulse** | First-time user (`isNew`) | Glow pulse 2.5s, opacity 40%→100% | First tap on dot | — (class removed on click) |
| 2 | **Bolt icon pulse** | Palette picker visible, Set 1 | Color pulse to white 2.5s | Tap bolt | `statusapp_seen_bolt` |
| 3 | **Flower icon pulse** | Palette picker visible, Set 2 | Color pulse to white 2.5s | Tap flower | `statusapp_seen_flower` |
| 4 | **Swatch wave** | Both bolt+flower seen, current set on default, not yet gone available with custom | Rolling wave across swatches 2-8, 300ms steps | Tap any swatch | `statusapp_went_avail_custom` |
| 5 | **Dot go-hint** | Non-default swatch selected, not yet gone available with custom | Subtle glow pulse using selected color 2.5s | Go available with custom color | `statusapp_went_avail_custom` |
| 6 | **Theme hint** (dotted ring blink) | Bolt+flower seen, gone available with custom, never entered palette mode | Dashed ring double-blink every 4s | Enter palette mode (double-tap swatch) | `statusapp_seen_theme` |

## Hint Coordination

| Action | Set-switch hint | Dot go-hint | Swatch wave |
|---|---|---|---|
| Tap non-default swatch | Paused (class removed, not cleared) | Started | Stopped |
| Tap default swatch | Resumed (if not cleared) | Stopped | Started |
| Tap set-switch icon | Cleared permanently | Unaffected | Unaffected |
| Switch sets (renderSwatchRow) | Fresh from localStorage | Only if current set non-default | Only if current set default |
| Go available with custom color | Unaffected | Stopped permanently | Stopped permanently |

## TODO

- [ ] Polish interaction of set switch hint, go-dot hint, and swatch wave hint
- [ ] Polish conditions for when the key swatch hint appears
- [ ] Adjust timing of the first appearance of Favorites Strip
