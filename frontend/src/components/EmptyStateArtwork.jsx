/**
 * EmptyStateArtwork.jsx - Studio Mixing Console & Tape Reel Artwork
 */

export default function EmptyStateArtwork({
  title = "No recordings found",
  description = "Record a meeting, upload an audio file, or adjust your filter.",
  actionText = "+ New meeting",
  onAction,
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {/* Studio Reel-to-Reel / Mixing Console SVG Artwork */}
      <div className="relative mb-6">
        <svg
          width="160"
          height="110"
          viewBox="0 0 160 110"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="opacity-90"
        >
          {/* Base Deck Console */}
          <rect
            x="10"
            y="20"
            width="140"
            height="80"
            rx="12"
            fill="var(--paper)"
            stroke="var(--line)"
            strokeWidth="2"
          />
          {/* Deck Line Grid */}
          <line x1="10" y1="62" x2="150" y2="62" stroke="var(--line)" strokeWidth="1.5" strokeDasharray="3 3" />
          
          {/* Left Reel */}
          <circle cx="45" cy="42" r="16" fill="var(--card)" stroke="var(--line)" strokeWidth="2" />
          <circle cx="45" cy="42" r="6" fill="var(--paper)" stroke="var(--pine)" strokeWidth="2" />
          <line x1="45" y1="28" x2="45" y2="56" stroke="var(--line)" strokeWidth="1.5" />
          <line x1="31" y1="42" x2="59" y2="42" stroke="var(--line)" strokeWidth="1.5" />
          
          {/* Right Reel */}
          <circle cx="115" cy="42" r="16" fill="var(--card)" stroke="var(--line)" strokeWidth="2" />
          <circle cx="115" cy="42" r="6" fill="var(--paper)" stroke="var(--amber)" strokeWidth="2" />
          <line x1="115" y1="28" x2="115" y2="56" stroke="var(--line)" strokeWidth="1.5" />
          <line x1="101" y1="42" x2="129" y2="42" stroke="var(--line)" strokeWidth="1.5" />

          {/* Tape Track Bridge */}
          <path d="M45 58 C 70 70, 90 70, 115 58" stroke="var(--muted)" strokeWidth="2" fill="none" />

          {/* VU Level Meters */}
          <rect x="25" y="74" width="45" height="14" rx="4" fill="var(--card)" stroke="var(--line)" />
          <rect x="29" y="78" width="6" height="6" rx="1" fill="var(--pine)" />
          <rect x="38" y="78" width="6" height="6" rx="1" fill="var(--pine)" />
          <rect x="47" y="78" width="6" height="6" rx="1" fill="var(--amber)" />
          <rect x="56" y="78" width="6" height="6" rx="1" fill="var(--brick)" opacity="0.3" />

          {/* Slider Faders */}
          <line x1="88" y1="74" x2="88" y2="88" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="88" cy="80" r="3" fill="var(--pine)" />

          <line x1="104" y1="74" x2="104" y2="88" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="104" cy="77" r="3" fill="var(--amber)" />

          <line x1="120" y1="74" x2="120" y2="88" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="120" cy="83" r="3" fill="var(--brick)" />

          {/* Glowing Red Record Indicator */}
          <circle cx="80" cy="30" r="4" fill="var(--brick)" className="animate-pulse" />
        </svg>
      </div>

      <h3 className="font-display text-xl font-medium text-ink mb-1.5">{title}</h3>
      <p className="text-sm text-muted max-w-sm mb-6 leading-relaxed">{description}</p>

      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className="btn btn-primary shadow-lg shadow-[rgba(79,169,140,0.2)]"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}
