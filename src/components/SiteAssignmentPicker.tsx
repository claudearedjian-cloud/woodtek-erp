"use client";

// Tick-box picker used by the user form: warehouses for a Warehouse Supervisor,
// floors for a Floor Supervisor. Items are grouped by branch.

export interface PickerItem {
  id: string;
  label: string;
}

export interface PickerGroup {
  label: string;
  items: PickerItem[];
}

interface Props {
  title: string;
  hint: string;
  groups: PickerGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
}

export default function SiteAssignmentPicker({ title, hint, groups, selected, onChange, emptyText }: Props) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div className="text-xs font-black text-white">{title}</div>
      <p className="mt-0.5 mb-2 text-[10px] text-slate-500">{hint}</p>
      {groups.length === 0 ? (
        <p className="text-[11px] text-amber-300">{emptyText}</p>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="mb-2 last:mb-0">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const on = selected.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(item.id)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                      on
                        ? "border-amber-400 bg-amber-500/20 text-amber-200"
                        : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
