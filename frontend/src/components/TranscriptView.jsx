/**
 * TranscriptView.jsx
 *
 * Renders a finished transcript in one of three modes:
 *
 *  1. Diarized (has_diarization=true, segments with speaker labels):
 *     Speaker-coloured view — each speaker gets a distinct colour badge.
 *     The badge only appears when the speaker changes, like a chat UI.
 *
 *  2. Segmented (segments present, no diarization):
 *     Timestamped segments — monospace timestamps in the left margin
 *     and spoken text beside each one.
 *
 *  3. Plain text (no segments — old transcripts loaded from the DB):
 *     Raw transcript as a flowing paragraph. Fully backwards-compatible.
 */

const SPEAKER_PALETTE = [
  { bg: "#EFF6FF", border: "#BFDBFE", badge: "#DBEAFE", text: "#1D4ED8", dot: "#2563EB" }, // royal blue
  { bg: "#F5F3FF", border: "#DDD6FE", badge: "#EDE9FE", text: "#6D28D9", dot: "#7C3AED" }, // violet
  { bg: "#F0F9FF", border: "#BAE6FD", badge: "#E0F2FE", text: "#0369A1", dot: "#0284C7" }, // sky
  { bg: "#F0FDF4", border: "#BBF7D0", badge: "#DCFCE7", text: "#15803D", dot: "#16A34A" }, // emerald
  { bg: "#FFFBEB", border: "#FDE68A", badge: "#FEF3C7", text: "#B45309", dot: "#D97706" }, // amber
  { bg: "#FFF1F2", border: "#FECDD3", badge: "#FFE4E6", text: "#BE123C", dot: "#E11D48" }, // rose
];

function getSpeakerColor(speaker) {
  const match = speaker && speaker.match(/(\d+)$/);
  const num = match ? parseInt(match[1], 10) : 1;
  return SPEAKER_PALETTE[(num - 1) % SPEAKER_PALETTE.length];
}

function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Language + confidence badge row — shown when those fields are available. */
function MetaBadges({ detectedLanguage, languageConfidence }) {
  if (!detectedLanguage && languageConfidence == null) return null;
  const lowConfidence = languageConfidence != null && languageConfidence < 0.6;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {detectedLanguage && (
        <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700 shadow-sm">
          Language: {detectedLanguage.toUpperCase()}
        </span>
      )}
      {languageConfidence != null && (
        <span
          className={[
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border",
            lowConfidence ? "bg-red-50 text-danger border-red-200" : "bg-slate-100 text-slate-700 border-slate-200",
          ].join(" ")}
        >
          Confidence: {(languageConfidence * 100).toFixed(0)}%
        </span>
      )}
      {lowConfidence && (
        <span className="text-xs text-danger font-medium">
          Low confidence — consider re-running with a specific language.
        </span>
      )}
    </div>
  );
}

/**
 * Diarized view: speaker-coloured segments grouped by speaker changes.
 */
function DiarizedView({ segments }) {
  return (
    <div className="rounded-2xl border border-white/85 bg-white/80 p-6 shadow-sm backdrop-blur-xl space-y-4">
      {segments.map((segment, i) => {
        const speaker = segment.speaker || "Speaker 1";
        const prevSpeaker = i > 0 ? (segments[i - 1].speaker || "Speaker 1") : null;
        const isNewSpeaker = speaker !== prevSpeaker;
        const colors = getSpeakerColor(speaker);

        return (
          <div key={i}>
            {/* Speaker label — only shown when speaker changes */}
            {isNewSpeaker && (
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: colors.dot }}
                />
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold backdrop-blur-md"
                  style={{
                    backgroundColor: colors.badge,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  {speaker}
                </span>
              </div>
            )}

            {/* Segment row */}
            <div
              className="flex gap-3 rounded-xl px-4 py-3 transition-colors backdrop-blur-md"
              style={{
                backgroundColor: isNewSpeaker ? colors.bg : "rgba(255, 255, 255, 0.4)",
                borderLeft: isNewSpeaker ? `3px solid ${colors.border}` : "3px solid transparent",
              }}
            >
              <span className="shrink-0 font-mono text-xs text-slate-500 pt-0.5 w-10 text-right">
                {formatTimestamp(segment.start)}
              </span>
              <p className="font-display text-[15px] leading-relaxed text-slate-900">
                {segment.text}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Standard timestamped segment list — no speaker colours. */
function SegmentedView({ segments }) {
  return (
    <div className="rounded-2xl border border-white/85 bg-white/80 divide-y divide-line/70 shadow-sm backdrop-blur-xl overflow-hidden">
      {segments.map((segment, i) => (
        <div key={i} className="flex gap-4 px-6 py-4 hover:bg-blue-50/40 transition-colors">
          <span className="shrink-0 font-mono text-xs font-semibold text-blue-600 pt-1 w-12 text-right">
            {formatTimestamp(segment.start)}
          </span>
          <p className="font-display text-[15px] leading-relaxed text-slate-900">
            {segment.text}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Plain-text fallback for old transcripts that have no segment data. */
function PlainTextView({ text }) {
  return (
    <div className="rounded-2xl border border-white/85 bg-white/80 p-6 shadow-sm backdrop-blur-xl">
      <p className="font-display text-[15px] leading-relaxed text-slate-900 whitespace-pre-wrap">
        {text || "No transcript content available."}
      </p>
    </div>
  );
}

export default function TranscriptView({ transcript }) {
  const {
    segments,
    text = "",
    detected_language,
    language_confidence,
    has_diarization = false,
  } = transcript || {};

  const hasSegments = Array.isArray(segments) && segments.length > 0;

  return (
    <div>
      <MetaBadges
        detectedLanguage={detected_language}
        languageConfidence={language_confidence}
      />

      {has_diarization && hasSegments && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-xs text-blue-700 border border-blue-200 shadow-sm font-medium">
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>
            <strong>Speaker identification enabled</strong> — segments are colour-coded by speaker.
          </span>
        </div>
      )}

      {/* Render the appropriate view */}
      {!hasSegments ? (
        <PlainTextView text={text} />
      ) : has_diarization ? (
        <DiarizedView segments={segments} />
      ) : (
        <SegmentedView segments={segments} />
      )}
    </div>
  );
}
