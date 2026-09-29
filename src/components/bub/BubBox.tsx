/** The BUB box — angular gift box used in the game and on the landing page. */
export function BubBox({ label, state = "idle", className = "" }: { label?: string; state?: "idle" | "shaking" | "open" | "dim"; className?: string }) {
  return (
    <svg viewBox="0 0 120 130" className={`${className} ${state === "shaking" ? "animate-shake" : ""} ${state === "dim" ? "opacity-30" : ""}`} aria-hidden>
      {/* lid */}
      <g style={{ transition: "transform 450ms cubic-bezier(.2,1.4,.4,1)", transform: state === "open" ? "translate(0px,-22px) rotate(-14deg)" : "none", transformOrigin: "20px 40px" }}>
        <polygon points="6,30 114,30 114,46 6,46" className="fill-bub-orange" />
        <polygon points="52,30 68,30 68,46 52,46" className="fill-bub-ink" />
        <path d="M60 30 C 44 8, 26 14, 38 28 M60 30 C 76 8, 94 14, 82 28" className="stroke-bub-white" strokeWidth="6" fill="none" strokeLinecap="square" />
      </g>
      {/* body */}
      <polygon points="12,48 108,48 108,116 96,128 12,128" className="fill-bub-ink stroke-bub-orange" strokeWidth="3" />
      <polygon points="52,48 68,48 68,128 52,128" className="fill-bub-orange" />
      {label && (
        <text x="30" y="100" fontFamily="Anton, Impact, sans-serif" fontSize="30" className="fill-bub-white" textAnchor="middle">
          {label}
        </text>
      )}
      {state === "open" && (
        <g>
          <polygon points="60,22 64,34 76,34 66,41 70,53 60,46 50,53 54,41 44,34 56,34" className="fill-bub-white" />
        </g>
      )}
    </svg>
  );
}
