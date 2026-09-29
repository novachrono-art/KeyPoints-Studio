/**
 * SkeletonRows.jsx - Loading skeleton rows for the meetings table
 */

export default function SkeletonRows({ count = 5 }) {
  return (
    <div className="divide-y divide-[var(--line)]">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="row py-5 px-6 animate-pulse"
        >
          {/* Title skeleton */}
          <div className="flex flex-col gap-2">
            <div className="h-4 w-3/4 rounded bg-blue-100/70 skeleton-shimmer" />
            <div className="h-3 w-1/2 rounded bg-slate-100 skeleton-shimmer" />
          </div>

          {/* Waveform skeleton */}
          <div className="flex items-center gap-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="w-1 rounded bg-blue-100/70 skeleton-shimmer"
                style={{ height: `${20 + ((i * 13) % 25)}px` }}
              />
            ))}
          </div>

          {/* Badge skeleton */}
          <div>
            <div className="h-6 w-24 rounded-full bg-blue-100/70 skeleton-shimmer" />
          </div>

          {/* Date skeleton */}
          <div>
            <div className="h-3.5 w-20 rounded bg-blue-100/70 skeleton-shimmer" />
          </div>

          {/* Actions skeleton */}
          <div className="flex gap-3">
            <div className="h-4 w-12 rounded bg-blue-100/70 skeleton-shimmer" />
            <div className="h-4 w-12 rounded bg-blue-100/70 skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}
