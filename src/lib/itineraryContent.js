/**
 * Swahili Tent Itinerary -- content engine.
 *
 * Pure functions, no React, no Supabase, no jsPDF. This is the layer that
 * turns booking/library data into a first draft, personalizes wording
 * within strict "never invent a fact" limits, keeps staff-only notes out of
 * anything guest-facing, and provides small editor utilities (autosave
 * debounce, smart photo ranking). `itineraryPdf.js` and the editor
 * components in App.jsx both consume this module; it depends on nothing
 * invoice-related and nothing here is imported by invoicePdf.js.
 *
 * CONTENT SHAPE (the `content` jsonb column on stv_itineraries):
 * {
 *   welcomeText: string,
 *   atAGlance: { keyExperiences: string[] },
 *   stay: { tentId, tentName, description, amenities: string[], heroImageUrl, heroImageId },
 *   days: [{
 *     id, label, date,
 *     activities: [{ id, time, title, description, imageUrl, imageId,
 *                    guestNote, internalNote, staffOnly }]
 *   }],
 *   experiences: [{ id, title, description, imageUrl, imageId, duration,
 *                   included, whatToBring, notes, internalNote, staffOnly }],
 *   stvExperience: { items: [{ id, title, description, imageUrl, imageId }] },
 *   included: string[],
 *   whatToBring: string[],
 *   pricing: { label, referencePrice, currentPrice, currency, note },
 *   terms: string,
 *   closing: { headline, message },
 *   routeStops: string[],
 *   guestRequests: string, guestRequestsVisible: bool,
 *   staffNotes: string,
 * }
 *
 * Each day activity may also carry a `type` (one of
 * "activity"|"excursion"|"transport"|"meal"|"special_touch"|
 * "accommodation_event"|"custom" -- absent/unrecognized types render as
 * "activity", so nothing written before this field existed breaks) plus
 * whichever of `locationText`, `included`, `transportInfo`, `mealNote`,
 * `dietaryNote`, `complimentary` are relevant to that type. These are
 * plain copies made once when an item is added from the library (see
 * LIBRARY_KINDS in App.jsx) -- there is no live link back to the library
 * row, so editing one never touches the other.
 *
 * Every `internalNote`/`staffOnly`/`staffNotes` field is written by the
 * editor's staff-only inputs and must NEVER reach a guest. `stripInternalFields()`
 * below is the single choke point that guarantees that before a PDF is
 * built or a guest preview is shown.
 */

export const GUEST_TYPES = [
  "couple", "family", "friends", "solo", "corporate",
  "birthday", "anniversary", "honeymoon", "wedding", "custom",
]

export function emptyItineraryContent() {
  return {
    welcomeText: "",
    preferences: "",
    atAGlance: { keyExperiences: [] },
    stay: { tentId: null, tentName: "", description: "", amenities: [], heroImageUrl: "", heroImageId: null },
    days: [],
    experiences: [],
    stvExperience: { items: [] },
    included: [],
    whatToBring: [],
    pricing: { label: "Package Investment", referencePrice: null, currentPrice: null, currency: "TZS", note: "" },
    terms: "",
    closing: { headline: "Karibu Zanzibar", message: "" },
    // A generated (never live/API-dependent) route section -- an ordered
    // list of real, admin-entered destination names rendered as a simple
    // vector flow diagram in the PDF (see itineraryPdf.js). `enabled`
    // lets the admin turn the whole section off without losing the list.
    routeStops: [],
    routeEnabled: true,
    // Guest Requests is opt-in guest-facing (admin must explicitly turn it
    // on for a given itinerary); Staff Notes is always internal -- it's
    // listed in INTERNAL_KEYS below so stripInternalFields() removes it
    // before any guest-safe content or PDF is built, the same guarantee
    // already proven for per-activity internalNote/staffOnly.
    guestRequests: "",
    guestRequestsVisible: false,
    staffNotes: "",
  }
}

export function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const a = new Date(`${checkIn}T00:00:00`)
  const b = new Date(`${checkOut}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const n = Math.round((b - a) / 86400000)
  return n > 0 ? n : null
}

export function addDays(dateStr, n) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + n)
  // Deliberately NOT d.toISOString().slice(0, 10) -- toISOString() converts
  // to UTC first, and the Date above was constructed in the browser's LOCAL
  // timezone (no "Z" suffix). For any positive UTC offset (which includes
  // East Africa Time, but also matters wherever this runs), that round-trip
  // silently rolls the date back one calendar day -- exactly the "Day 1 says
  // 6 September when check-in is 7 September" bug this fixes. Building the
  // string from the Date's own local getters avoids the UTC conversion
  // entirely, so the result always matches the calendar day setDate() moved
  // to, regardless of timezone.
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// Deterministic (not random) small string hash -- used to pick a phrase-bank
// variation so the SAME inputs always produce the SAME wording (a draft
// regenerated twice from identical data doesn't look "flaky"), while
// different guests/occasions land on different phrasing.
function stableHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function pick(list, seed) {
  return list[stableHash(seed) % list.length]
}

// One of several natural-language openings per guest type/occasion. Every
// template only ever references a placeholder for a field the caller
// actually supplied (see buildWelcomeText) -- nothing here invents a detail
// that wasn't given to it.
const OPENERS = {
  couple: [
    "Your private Zanzibar escape starts the moment you arrive.",
    "A quiet corner of Zanzibar, set aside just for the two of you.",
    "We've shaped the days ahead around time together, at your own pace.",
  ],
  family: [
    "Your family's Zanzibar adventure begins here.",
    "Days built for everyone -- the little ones included.",
    "A stay shaped around time together, with room for everyone's pace.",
  ],
  friends: [
    "Your Zanzibar trip together, mapped out from arrival to departure.",
    "The days ahead are built around good company and the island itself.",
  ],
  solo: [
    "Your own Zanzibar, on your own terms.",
    "A stay shaped entirely around your pace and your interests.",
  ],
  corporate: [
    "A thoughtfully planned Zanzibar retreat for your team.",
    "Your group's time in Zanzibar, organized end to end.",
  ],
  birthday: [
    "Your birthday in Zanzibar starts here.",
    "A celebration shaped around the island, and around you.",
  ],
  anniversary: [
    "Since you're celebrating your anniversary in Zanzibar, we've shaped these days around private time, island experiences and relaxed evenings at Swahili Tent Village.",
    "Your anniversary in Zanzibar -- days built for the two of you.",
  ],
  honeymoon: [
    "Your honeymoon in Zanzibar starts the moment you arrive.",
    "The first days of this next chapter, set against Zanzibar.",
  ],
  wedding: [
    "Your celebration in Zanzibar, planned from arrival to departure.",
  ],
  custom: [
    "Your time in Zanzibar, planned around what matters to you.",
  ],
}

/**
 * Builds a personalized welcome paragraph. Only ever mentions fields that
 * were actually passed in -- a missing tentName, date range, experience
 * list, or preferences note is simply omitted from the sentence, never
 * guessed at. This is the deterministic fallback path: it runs unchanged
 * whether or not AI personalization (see the admin-backend
 * /admin/itinerary/personalize route) is configured or available.
 */
export function buildWelcomeText({ guestName, guestType = "custom", occasion, tentName, checkIn, checkOut, keyExperiences = [], preferences }) {
  const seed = `${guestName || ""}|${guestType}|${occasion || ""}|${checkIn || ""}`
  const openerList = OPENERS[guestType] || OPENERS.custom
  const opener = pick(openerList, seed)

  const parts = [opener]

  const nights = nightsBetween(checkIn, checkOut)
  if (nights && tentName) {
    parts.push(`You'll be staying with us for ${nights} night${nights === 1 ? "" : "s"} at ${tentName}.`)
  } else if (tentName) {
    parts.push(`You'll be staying with us at ${tentName}.`)
  } else if (nights) {
    parts.push(`You'll be with us for ${nights} night${nights === 1 ? "" : "s"}.`)
  }

  if (keyExperiences.length === 1) {
    parts.push(`We've built your days around ${keyExperiences[0]}, alongside time to simply enjoy Swahili Tent Village itself.`)
  } else if (keyExperiences.length > 1) {
    const last = keyExperiences[keyExperiences.length - 1]
    const rest = keyExperiences.slice(0, -1).join(", ")
    parts.push(`We've built your days around ${rest} and ${last}, alongside time to simply enjoy Swahili Tent Village itself.`)
  }

  if (preferences && preferences.trim()) {
    parts.push(`You mentioned wanting ${preferences.trim().toLowerCase()} -- we've kept that in mind throughout.`)
  }

  if (occasion && guestType !== "custom" && !openerList[0].toLowerCase().includes(occasion.toLowerCase())) {
    parts.push(`We hope this makes your ${occasion.toLowerCase()} in Zanzibar a memorable one.`)
  }

  return parts.join(" ")
}

/**
 * Auto-generates a plausible first-draft day-by-day skeleton. Never
 * hardcodes a fixed schedule -- the shape (arrival / one day per selected
 * excursion / relaxation filler / departure) is derived from how many
 * nights there are and which library items were selected, and every
 * generated activity carries only fields the caller actually supplied
 * (a library item's own default_time/default_duration_minutes/location, or
 * nothing at all -- never an invented specific time).
 *
 * `libraryItems` -- array of stv_itinerary_library rows the admin selected
 * for this proposal (kind: 'excursion'|'transport'|'meal'|'special_touch'|
 * 'generic'), already in the order they should appear.
 */
export function generateDraftDays({ checkIn, checkOut, libraryItems = [] }) {
  const nights = nightsBetween(checkIn, checkOut)
  const dayCount = nights ? nights + 1 : Math.max(libraryItems.length, 1)

  const pickup = libraryItems.find((it) => it.kind === "transport" && /pick ?up|arrival/i.test(it.title || ""))
  const dropoff = libraryItems.find((it) => it.kind === "transport" && /drop ?off|depart/i.test(it.title || ""))
  const excursions = libraryItems.filter((it) => it.kind === "excursion")
  const meals = libraryItems.filter((it) => it.kind === "meal")

  const days = []
  for (let i = 0; i < dayCount; i++) {
    const date = checkIn ? addDays(checkIn, i) : null
    const isFirst = i === 0
    const isLast = i === dayCount - 1
    const activities = []

    if (isFirst) {
      if (pickup) {
        activities.push(libraryItemToActivity(pickup))
      }
      activities.push({ id: cryptoId(), type: "activity", time: "", title: "Check-in & Welcome", description: "Settle in, relax and begin discovering Swahili Tent Village before the evening ahead." })
    } else if (isLast && dayCount > 1) {
      activities.push({ id: cryptoId(), type: "meal", time: "", title: "Breakfast", description: "" })
      activities.push({ id: cryptoId(), type: "activity", time: "", title: "Check-out", description: "" })
      if (dropoff) activities.push(libraryItemToActivity(dropoff))
    } else {
      activities.push({ id: cryptoId(), type: "meal", time: "", title: "Breakfast", description: "" })
      const excursion = excursions[i - 1]
      if (excursion) {
        activities.push(libraryItemToActivity(excursion))
      } else {
        activities.push({ id: cryptoId(), type: "activity", time: "", title: "At Your Leisure", description: "Take the day at your own pace -- enjoy the swimming pool, restaurant and grounds at Swahili Tent Village, or simply relax before the evening ahead." })
      }
    }

    const dinnerMeal = meals.find((m) => /dinner/i.test(m.title || ""))
    if (!isLast) {
      activities.push(dinnerMeal ? libraryItemToActivity(dinnerMeal) : { id: cryptoId(), type: "meal", time: "", title: "Dinner", description: "" })
    }

    days.push({
      id: cryptoId(),
      label: isFirst ? "Arrival" : isLast && dayCount > 1 ? "Departure" : (excursions[i - 1]?.title || "At Your Leisure"),
      date,
      activities,
    })
  }
  return days
}

// Maps a library `kind` to the day-item `type` used by the editor/PDF.
// "generic" has no dedicated type of its own -- it becomes a "custom" item,
// pre-filled from the library row but otherwise a normal custom entry.
const KIND_TO_TYPE = { excursion: "excursion", transport: "transport", meal: "meal", special_touch: "special_touch", generic: "custom" }

function minutesToDuration(mins) {
  if (!mins) return ""
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} hr ${m} min` : `${h} hr${h === 1 ? "" : "s"}`
}

// Copies a library row's fields onto a plain day-item object -- a one-time
// snapshot, not a live reference (`libraryItemId` is kept only as an
// informational trail; nothing re-reads it, so later edits to either the
// library row or this copy never affect the other, per "the admin should
// still be able to override/edit the details for that specific guest").
export function libraryItemToActivity(item) {
  return {
    id: cryptoId(),
    type: KIND_TO_TYPE[item.kind] || "custom",
    time: item.default_time || "",
    duration: minutesToDuration(item.default_duration_minutes),
    title: item.title,
    description: item.guest_facing_description || item.short_description || "",
    locationText: item.location || item.meeting_point || "",
    transportInfo: item.transport_info || "",
    mealNote: item.meals_included || "",
    complimentary: item.complimentary !== false,
    included: item.complimentary !== false || !!item.whats_included,
    libraryItemId: item.id,
  }
}

function cryptoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Suggests approved `special_touch` library items relevant to this guest's
 * type/occasion, by plain tag matching against each item's
 * `guest_type_tags` -- e.g. guest_type "anniversary" matches a library row
 * tagged ["anniversary","honeymoon"]. This is NOT an AI call and never
 * invents anything: it only ever returns rows the admin has already
 * created and approved in the Content Library, ranked by tag-match count,
 * with untagged/unmatched rows still included at the end so nothing is
 * ever hidden -- it's a sort, not a filter, matching the same
 * "suggestions never remove admin control" rule as suggestMediaForQuery().
 * The caller (the editor's "Suggested Special Touches" strip) always
 * presents these as one-click "Add" actions the admin can ignore.
 */
export function suggestSpecialTouches({ guestType, occasion }, libraryItems = []) {
  const touches = libraryItems.filter((it) => it.kind === "special_touch" && it.is_active !== false)
  const needles = [guestType, occasion].filter(Boolean).map((s) => String(s).toLowerCase())
  if (!needles.length) return touches
  const score = (item) => {
    const tags = (item.guest_type_tags || []).map((t) => String(t).toLowerCase())
    return needles.reduce((acc, n) => acc + (tags.includes(n) ? 1 : 0), 0)
  }
  return [...touches].sort((a, b) => score(b) - score(a))
}

/**
 * Ranks media library items by relevance to a free-text query (an activity
 * or accommodation name/tag), by simple case-insensitive substring overlap
 * against title/category/tags. This is intentionally NOT machine learning
 * or an external API -- "smart" here means "pre-sorted by relevance", and
 * the full list is always returned (never filtered down to nothing) so the
 * admin can still find and pick any photo, per the "suggestions never
 * remove admin control" requirement.
 */
export function suggestMediaForQuery(query, mediaList = []) {
  const words = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (!words.length) return mediaList
  const score = (item) => {
    const haystack = [item.title, item.category, ...(item.tags || [])].join(" ").toLowerCase()
    return words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0)
  }
  return [...mediaList].sort((a, b) => score(b) - score(a))
}

// Recursively strips staff-only content before anything reaches a guest
// preview or the PDF renderer -- the single choke point for the
// guest/staff separation the product spec requires. Removes any
// `internalNote`/`internal_notes` key outright, and drops array entries
// flagged `staffOnly: true` entirely (not just hidden).
const INTERNAL_KEYS = new Set(["internalNote", "internal_notes", "staffOnly", "internalCost", "internalContact", "staffNotes"])

export function stripInternalFields(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(item && typeof item === "object" && item.staffOnly === true))
      .map(stripInternalFields)
  }
  if (value && typeof value === "object") {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (INTERNAL_KEYS.has(k)) continue
      out[k] = stripInternalFields(v)
    }
    return out
  }
  return value
}

// Small debounce helper for the editor's autosave -- no new dependency.
export function debounce(fn, wait) {
  let t = null
  const debounced = (...args) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
  debounced.cancel = () => { if (t) clearTimeout(t) }
  return debounced
}
