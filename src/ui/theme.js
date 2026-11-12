/* Shared design tokens + base style objects for the POS UI.
   Extracted verbatim from App.jsx so new modules (e.g. the Operations
   Documents centre) render with exactly the same look. */
/* ── DESIGN TOKENS ──────────────────────────────────────────
   A small, consistent scale so spacing/radius/shadow/color
   stop being ad hoc per element. Brand accents (sage + terracotta)
   are kept, just used with more restraint — neutral surfaces,
   color reserved for meaning (brand action, money in/out, status). */
export const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif"
export const RADIUS = { sm: 8, md: 12, lg: 16, pill: 999 }
export const SPACE  = { xs:8, sm:12, md:16, lg:20, xl:24, xxl:32 }
export const C = {
  bg:        "#F7F7F6",
  surface:   "#FFFFFF",
  border:    "#EBE8E3",
  borderStrong: "#DCD8D1",
  text:      "#1F2233",
  textSub:   "#4B5163",   // ~7.9:1 on white — WCAG AAA
  textFaint: "#6B7080",   // ~4.9:1 on white — WCAG AA (was #9A9FAE at 2.6:1, failed)
  accent:      "#6FA88E",   // sage — badges/icons/borders (not for white-on-fill text)
  accentHover: "#5F9680",
  accentSoft:  "#EDF4F0",
  accentStrong:      "#3F7259", // ~5.6:1 with white text — use for solid buttons/CTAs
  accentStrongHover: "#345F49",
  warn:        "#E07A5F",   // terracotta — money-out / destructive / errors (badges, icons)
  warnHover:   "#C96A50",
  warnSoft:    "#FBEEE9",
  warnStrong:      "#A34E33",  // ~5.7:1 with white text, ~5:1 as text on warnSoft
  warnStrongHover: "#8A4129",
  sidebar:     "#20222E",
  sidebarBorder: "rgba(255,255,255,0.08)",
  sidebarText:   "#9CA0B4",
}
export const SHADOW = {
  card:  "0 1px 2px rgba(20,20,30,0.04), 0 1px 3px rgba(20,20,30,0.05)",
  hover: "0 6px 20px rgba(20,20,30,0.08)",
  modal: "0 24px 48px rgba(20,20,30,0.16)",
}

/* ── SHARED STYLE CONSTANTS ──────────────────────────────── */
export const iS    = { width:"100%", padding:"11px 14px", border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, fontSize:14, outline:"none", background:C.surface, fontFamily:FONT, color:C.text }
export const seS   = { padding:"9px 12px", border:`1.5px solid ${C.border}`, borderRadius:RADIUS.sm, fontSize:12.5, background:C.surface, fontFamily:FONT, color:C.textSub, fontWeight:500 }
export const lS    = { display:"block", fontSize:11, fontWeight:600, color:C.textSub, marginBottom:6, textTransform:"uppercase", letterSpacing:.5 }
export const fC    = { background:C.surface, borderRadius:RADIUS.md, padding:SPACE.xl, flexShrink:0, border:`1px solid ${C.border}`, boxShadow:SHADOW.card }
export const fTi   = { margin:"0 0 20px", fontFamily:FONT, fontWeight:700, fontSize:"clamp(15px, 2.2vw, 17px)", color:C.text, letterSpacing:"-0.01em" }
export const sB    = { width:"100%", padding:"13px", background:C.accentStrong, color:"#fff", border:"none", borderRadius:RADIUS.sm, fontSize:14.5, fontWeight:600, cursor:"pointer", fontFamily:FONT }
export const tS    = { padding:"12px 0", paddingRight:12, fontSize:13, color:C.text, verticalAlign:"middle" }
export const pT    = { margin:"0 0 6px", fontFamily:FONT, fontWeight:700, fontSize:"clamp(19px, 3.4vw, 24px)", color:C.text, letterSpacing:"-0.01em" }
export const panelS = { background:C.surface, borderRadius:RADIUS.md, padding:SPACE.xl, border:`1px solid ${C.border}`, boxShadow:SHADOW.card }
