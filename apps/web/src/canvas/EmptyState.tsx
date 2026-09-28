import { FilePlus2, FileSpreadsheet, FolderOpen, Plus } from "lucide-react";
import { useUi } from "../store/ui";
import { Button, Kbd } from "../ui/primitives";
import { svc } from "../lib/services";
import { openExample } from "../lib/projects";
import { runAction } from "../lib/actions";

/** Zero-tutorial empty state: one centred CTA (§5.5). */
export function EmptyState() {
  const ui = useUi();
  const examples = svc().examples;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto flex flex-col items-center gap-3 text-center">
        <Button variant="primary" className="h-10 px-4 text-base" onClick={() => runAction("addConnector")}>
          <Plus size={18} /> Add your first connector
        </Button>
        <div className="text-xs text-text-tertiary">
          or double-click anywhere, or press <Kbd>C</Kbd>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm">
          <Button variant="ghost" size="sm" onClick={() => ui.openDialog("import")}>
            <FileSpreadsheet size={14} /> or import a wire list
          </Button>
          {examples[0] && (
            <Button variant="ghost" size="sm" onClick={() => void openExample(examples[0]!.id)}>
              <FilePlus2 size={14} /> or open an example: {examples[0].name}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => ui.openDialog("open")}>
            <FolderOpen size={14} /> Projects
          </Button>
        </div>
      </div>
    </div>
  );
}
