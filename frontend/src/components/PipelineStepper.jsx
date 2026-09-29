/**
 * PipelineStepper.jsx
 *
 * Shows the meeting's progress through the real backend pipeline:
 * Upload -> Process (FFmpeg + Whisper) -> Generate MOM -> Review.
 */

const STAGES = [
  { key: "upload", label: "Upload" },
  { key: "process", label: "Process & transcribe" },
  { key: "mom", label: "Generate MOM" },
  { key: "review", label: "Review & edit" },
];

export default function PipelineStepper({ currentStage }) {
  const currentIndex = STAGES.findIndex((s) => s.key === currentStage);

  return (
    <ol className="flex items-center gap-2 sm:gap-4">
      {STAGES.map((stage, index) => {
        const isComplete = index < currentIndex;
        const isActive = index === currentIndex;

        return (
          <li key={stage.key} className="flex items-center gap-2 sm:gap-4 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold transition-all",
                  isComplete
                    ? "bg-blue-600 text-white shadow-sm"
                    : isActive
                    ? "bg-blue-100 text-blue-700 border-2 border-blue-600 shadow-sm"
                    : "bg-white text-slate-400 border border-line",
                ].join(" ")}
              >
                {isComplete ? "✓" : index + 1}
              </span>
              <span
                className={[
                  "text-sm hidden sm:inline font-medium",
                  isActive ? "text-blue-700 font-semibold" : isComplete ? "text-slate-800" : "text-slate-400",
                ].join(" ")}
              >
                {stage.label}
              </span>
            </div>
            {index < STAGES.length - 1 && (
              <span
                className={[
                  "h-0.5 flex-1 rounded-full",
                  isComplete ? "bg-blue-600" : "bg-line",
                ].join(" ")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
