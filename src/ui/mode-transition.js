import { shouldReduceMotion } from "./core.js";

// The reader is the current card, maximized — and the flight is what teaches
// that. Expanding inflates the reader out of the card's on-screen rect;
// restoring deflates it back into place, with the canvas visible underneath
// the whole way. macOS window-zoom, not a crossfade: geometry continuity is
// the affordance, so after one flight the way back needs no explanation.
//
// The mode classes flip synchronously before a flight starts; the animation is
// purely decorative and interruptible. `mode-flight` on <body> keeps both
// surfaces displayed for the duration, and `.reader-flying` gives the reader
// its in-flight card costume (clipped corners, shadow, no pointer events).
var FLIGHT_MS = 260;
var FLIGHT_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
var activeFlight = null;

function endFlight(flight){
  if (activeFlight !== flight) return;
  activeFlight = null;
  document.body.classList.remove("mode-flight");
  flight.el.classList.remove("reader-flying");
  // Landed: anything that measures the reader's on-screen geometry (the PDF
  // toolbar centers itself this way) can now trust getBoundingClientRect.
  document.dispatchEvent(new CustomEvent("rh-reader-flight-end"));
}

export function cancelReaderFlight(){
  var flight = activeFlight;
  if (!flight) return;
  try { flight.animation.cancel(); } catch (e) { endFlight(flight); }
}

// transform-origin is 0 0 (set by .reader-flying), so a screen rect maps to a
// plain translate + non-uniform scale of the full-viewport reader.
function rectTransform(el, rect){
  var w = el.clientWidth || window.innerWidth || 1;
  var h = el.clientHeight || window.innerHeight || 1;
  return "translate(" + rect.left + "px," + rect.top + "px) scale(" +
    Math.max(rect.width / w, 0.001) + "," + Math.max(rect.height / h, 0.001) + ")";
}

function fly(rect, expanding){
  cancelReaderFlight();
  var el = document.getElementById("reader");
  if (!el || !rect || !rect.width || !rect.height) return;
  if (typeof el.animate !== "function" || shouldReduceMotion() || document.hidden) return;
  var cardFrame = { transform: rectTransform(el, rect) };
  var fullFrame = { transform: "none" };
  document.body.classList.add("mode-flight");
  el.classList.add("reader-flying");
  var animation = el.animate(
    expanding ? [cardFrame, fullFrame] : [fullFrame, cardFrame],
    { duration: FLIGHT_MS, easing: FLIGHT_EASE }
  );
  var flight = { el: el, animation: animation };
  activeFlight = flight;
  animation.onfinish = function(){ endFlight(flight); };
  animation.oncancel = function(){ endFlight(flight); };
}

// Canvas → reader: grow the reader out of the card it came from.
export function flyReaderFromRect(rect){ fly(rect, true); }

// Reader → canvas: shrink the reader back into the card it is.
export function flyReaderToRect(rect){ fly(rect, false); }
