/**
 * StatusBadge.jsx
 *
 * Glassmorphism Theme Status Badge.
 */

const STATUS_STYLES = {
  uploaded: "bg-amber-50/85 text-amber-700 border border-amber-200/90",
  processing_audio: "bg-amber-50/85 text-amber-700 border border-amber-200/90",
  transcribing: "bg-blue-50/85 text-blue-700 border border-blue-200/90",
  transcription_partial: "bg-amber-50/85 text-amber-700 border border-amber-200/90",
  transcribed: "bg-emerald-50/85 text-emerald-700 border border-emerald-200/90",
  generating_mom: "bg-blue-50/85 text-blue-700 border border-blue-200/90",
  mom_generated: "bg-emerald-50/85 text-emerald-700 border border-emerald-200/90",
  completed: "bg-emerald-50/85 text-emerald-700 border border-emerald-200/90",
  failed: "bg-red-50/85 text-red-700 border border-red-200/90",
  transcription_failed: "bg-red-50/85 text-red-700 border border-red-200/90",
  mom_generation_failed: "bg-red-50/85 text-red-700 border border-red-200/90",
};

const STATUS_LABELS = {
  uploaded: "Uploaded",
  processing_audio: "Processing",
  transcribing: "Transcribing",
  transcription_partial: "Partial transcript",
  transcribed: "Transcribed",
  generating_mom: "Generating MOM",
  mom_generated: "Completed",
  completed: "Completed",
  failed: "Failed",
  transcription_failed: "Transcription failed",
  mom_generation_failed: "MOM generation failed",
};

function humanize(status) {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  return (status || "").replace(/_/g, " ") || "Unknown";
}

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || "bg-slate-100/80 text-slate-600 border border-slate-200/90";
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-xs tracking-wider uppercase font-semibold backdrop-blur-md shadow-xs ${style}`}
    >
      {humanize(status)}
    </span>
  );
}
