import { memo } from "react";
import type { Note } from "@hs/model";
import { semantic } from "@hs/ui-tokens";

export const NotesLayer = memo(function NotesLayer({ notes, theme, selected, offset }: { notes: Note[]; theme: "dark" | "light"; selected: Set<string>; offset: { id: string; dx: number; dy: number } | null }) {
  return (
    <g>
      {notes.map((n) => {
        const dx = offset?.id === n.id ? offset.dx : 0;
        const dy = offset?.id === n.id ? offset.dy : 0;
        const lines = n.text.split("\n");
        const w = Math.max(80, Math.max(...lines.map((l) => l.length)) * 6.8 + 16);
        const hgt = lines.length * 15 + 12;
        return (
          <g key={n.id} data-hit="note" data-id={n.id} transform={`translate(${n.position.x + dx},${n.position.y + dy})`} style={{ cursor: "move" }}>
            <title>Note: double-click to edit</title>
            <rect width={w} height={hgt} rx={6} fill={semantic("bg.surface-2", theme)} stroke={selected.has(n.id) ? semantic("accent", theme) : semantic("border.control", theme)} strokeDasharray="4 3" />
            {lines.map((l, i) => (
              <text key={i} x={8} y={18 + i * 15} fontSize={12} fill={semantic("text.secondary", theme)}>
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
});
