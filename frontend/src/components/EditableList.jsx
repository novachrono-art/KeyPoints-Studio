/**
 * EditableList.jsx
 *
 * A generic editable list of plain-text items - reused for
 * participants, discussion_points, decisions, and pending_issues in
 * MomView.jsx. Each field has the exact same "add/edit/remove" shape
 * on the backend (array of strings), so one component covers all four
 * rather than four near-identical ones.
 */

export default function EditableList({ label, items, onChange, emptyHint }) {
  function updateItem(index, value) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }

  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    onChange([...items, ""]);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-ink">
          {label}
        </h3>
        <button
          type="button"
          onClick={addItem}
          className="text-xs font-medium text-accent hover:text-accent-dark"
        >
          + Add
        </button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted italic">
          {emptyHint || "None found in the transcript."}
        </p>
      )}

      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            <textarea
              value={item}
              onChange={(e) => updateItem(index, e.target.value)}
              rows={1}
              className="flex-1 resize-y rounded-xl border border-line bg-white/70 px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all backdrop-blur-md"
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              aria-label={`Remove ${label} item`}
              className="mt-2 shrink-0 text-muted hover:text-danger px-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
