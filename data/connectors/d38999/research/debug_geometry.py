import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from d38999.geometry import build
from d38999.decoder import decode
from d38999.database import Database
seen=[]
def trace(frame,event,arg):
    if frame.f_code.co_name=='build' and event=='line':
        for name in ('shell','neck'):
            shape=frame.f_locals.get(name)
            if shape is not None and not any(shape is s for s in seen):
                seen.append(shape)
                bb=shape.BoundingBox()
                print(frame.f_lineno,name,shape.isValid(),shape.Volume(),len(shape.Solids()),(bb.zmin,bb.zmax),flush=True)
                if name=='neck':
                    import cadquery as cq
                    cq.exporters.export(shape,f'output/neck_debug_{frame.f_lineno}.step')
    return trace
sys.settrace(trace)
build(decode(sys.argv[1] if len(sys.argv)>1 else 'D38999/24FA35PN'),Database(),'helical')
