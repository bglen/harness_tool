import { useUi } from "../store/ui";
import { AccessoriesPopover, BackshellPopover, FacePopover } from "./ConnectorPopovers";
import { BootPopover, CablePopover, LabelEditPopover, LabelPopover, MatePopover, NetPopover, NoteEditPopover, PropertySheet, ShieldPopover, SplicePopover, TerminationsPopover } from "./MiscPopovers";
import { CoveringPopover, SegmentLengthPopover, TieDownsPopover } from "./SegmentPopovers";
import { WirePropsPopover } from "./WireProps";
import { PartPicker } from "./PartPicker";
import { ContextMenu } from "../canvas/ContextBar";

export function Popovers() {
  const pop = useUi((s) => s.popover);
  const picker = useUi((s) => s.picker);
  const ctx = useUi((s) => s.contextMenu);
  let el: JSX.Element | null = null;
  if (pop) {
    const { x, y } = pop.screen;
    const d = pop.data ?? {};
    const ids: string[] = d.ids ?? [];
    switch (pop.kind) {
      case "wireProps":
        el = <WirePropsPopover x={x} y={y} ids={ids} />;
        break;
      case "backshell":
        el = <BackshellPopover x={x} y={y} connectorId={ids[0]!} />;
        break;
      case "accessories":
        el = <AccessoriesPopover x={x} y={y} connectorId={ids[0]!} />;
        break;
      case "face":
        el = <FacePopover x={x} y={y} connectorId={d.connectorId} />;
        break;
      case "covering":
        el = <CoveringPopover x={x} y={y} segmentIds={ids} />;
        break;
      case "segmentLength":
        el = <SegmentLengthPopover x={x} y={y} segmentId={ids[0]!} />;
        break;
      case "tiedowns":
        el = <TieDownsPopover x={x} y={y} segmentId={ids[0]!} />;
        break;
      case "label":
        el = <LabelPopover x={x} y={y} kind={d.kind} ids={ids} />;
        break;
      case "labelEdit":
        el = <LabelEditPopover x={x} y={y} id={d.id} />;
        break;
      case "noteEdit":
        el = <NoteEditPopover x={x} y={y} id={d.id} />;
        break;
      case "net":
        el = <NetPopover x={x} y={y} ids={ids} />;
        break;
      case "shield":
        el = <ShieldPopover x={x} y={y} ids={ids} />;
        break;
      case "cable":
        el = <CablePopover x={x} y={y} ids={ids} />;
        break;
      case "splice":
        el = <SplicePopover x={x} y={y} id={ids[0]!} />;
        break;
      case "boot":
        el = <BootPopover x={x} y={y} id={ids[0]!} />;
        break;
      case "terminations":
        el = <TerminationsPopover x={x} y={y} id={ids[0]!} />;
        break;
      case "mate":
        el = <MatePopover x={x} y={y} a={d.a} b={d.b} />;
        break;
      case "sheet":
        el = <PropertySheet x={x} y={y} kind={d.kind} ids={ids} />;
        break;
    }
  }
  return (
    <>
      {el}
      {picker && <PartPicker />}
      {ctx && <ContextMenu />}
    </>
  );
}
