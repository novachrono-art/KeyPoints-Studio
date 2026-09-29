/**
 * ActionItemsTable.jsx
 *
 * Editable table for action_items - each row is
 * { task, assignee, deadline, status, priority }, matching the backend's
 * ActionItem schema exactly (Phase 11 - Advanced MOM intelligence).
 */

const STATUS_OPTIONS = ["pending", "in_progress", "done", "blocked"];
const PRIORITY_OPTIONS = ["low", "medium", "high"];

function Select({ value, options, placeholder, onChange }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className="w-full rounded-lg border border-line bg-white/70 text-ink px-2.5 py-1.5 text-xs font-medium focus:border-accent focus:bg-white focus:outline-none transition-all backdrop-blur-md"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

export default function ActionItemsTable({ items, onChange }) {
  function updateItem(index, field, value) {
    const next = [...items];
    next[index] = { ...next[index], [field]: value === "" ? null : value };
    onChange(next);
  }

  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    onChange([
      ...items,
      { task: "", assignee: null, deadline: null, status: null, priority: null },
    ]);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-ink">
          Action Items
        </h3>
        <button
          type="button"
          onClick={addItem}
          className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
        >
          + Add item
        </button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted italic">
          None found in the transcript.
        </p>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line/80 bg-white/60 backdrop-blur-md shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 text-left text-xs font-semibold text-slate-700 border-b border-line/80">
                <th className="px-3.5 py-3 w-[32%]">Task</th>
                <th className="px-3 py-3 w-[16%]">Assignee</th>
                <th className="px-3 py-3 w-[16%]">Deadline</th>
                <th className="px-3 py-3 w-[14%]">Status</th>
                <th className="px-3 py-3 w-[14%]">Priority</th>
                <th className="px-3 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {items.map((item, index) => (
                <tr key={index} className="hover:bg-blue-50/50 transition-colors">
                  <td className="px-3.5 py-2.5 align-top">
                    <textarea
                      value={item.task}
                      onChange={(e) => updateItem(index, "task", e.target.value)}
                      rows={1}
                      className="w-full resize-y rounded-lg border border-line bg-white/70 text-ink px-2.5 py-1.5 text-xs font-medium focus:border-accent focus:bg-white focus:outline-none transition-all backdrop-blur-md"
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <input
                      type="text"
                      value={item.assignee ?? ""}
                      placeholder="Not specified"
                      onChange={(e) => updateItem(index, "assignee", e.target.value)}
                      className="w-full rounded-lg border border-line bg-white/70 text-ink px-2.5 py-1.5 text-xs placeholder:text-faint focus:border-accent focus:bg-white focus:outline-none transition-all backdrop-blur-md"
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <input
                      type="text"
                      value={item.deadline ?? ""}
                      placeholder="Not specified"
                      onChange={(e) => updateItem(index, "deadline", e.target.value)}
                      className="w-full rounded-lg border border-line bg-white/70 text-ink px-2.5 py-1.5 text-xs placeholder:text-faint focus:border-accent focus:bg-white focus:outline-none transition-all backdrop-blur-md"
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Select
                      value={item.status}
                      options={STATUS_OPTIONS}
                      placeholder="Status"
                      onChange={(v) => updateItem(index, "status", v)}
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Select
                      value={item.priority}
                      options={PRIORITY_OPTIONS}
                      placeholder="Priority"
                      onChange={(v) => updateItem(index, "priority", v)}
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      aria-label="Remove action item"
                      className="text-slate-400 hover:text-red-600 mt-1 px-1 transition-colors"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
