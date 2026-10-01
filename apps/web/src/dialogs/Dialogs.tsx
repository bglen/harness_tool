import { useUi } from "../store/ui";
import { CommandPalette, FinishDialog, FreezeDialog, OpenDialog, PottingDialog, SettingsDialog, ShortcutsDialog } from "./BasicDialogs";
import { DfmDialog } from "./DfmDialog";
import { RulesManager } from "./RulesManager";
import { PedigreeCompare, PedigreeEditor } from "./PedigreeDialogs";
import { ImportDialog } from "./ImportDialog";
import { OrderFlow } from "./OrderFlow";
import { TemplateEditor } from "../drawing/TemplateEditor";

export function Dialogs() {
  const d = useUi((s) => s.dialogs);
  return (
    <>
      {d.palette && <CommandPalette />}
      {d.shortcuts && <ShortcutsDialog />}
      {d.open && <OpenDialog />}
      {d.freeze && <FreezeDialog />}
      {d.settings && <SettingsDialog />}
      {d.potting && <PottingDialog connectorId={d.potting.connectorId} />}
      {d.finish && <FinishDialog segmentIds={d.finish === true ? undefined : d.finish.segmentIds} />}
      {d.dfm && <DfmDialog data={d.dfm} />}
      {d.rules && <RulesManager data={d.rules} />}
      {d.pedigreeEditor && <PedigreeEditor />}
      {d.pedigreeCompare && <PedigreeCompare />}
      {d.import && <ImportDialog data={d.import} />}
      {d.order && <OrderFlow />}
      {d.templateEditor && <TemplateEditor data={d.templateEditor} />}
    </>
  );
}
