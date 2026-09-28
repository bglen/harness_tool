import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import cadquery as cq
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepLib import BRepLib
from d38999.geometry import *
from d38999.database import Database
db=Database()
seen=[]
def trace(frame,event,arg):
    if frame.f_code.co_name=='thread_cut' and event=='line':
        for name in ('cutter','clipped','shape'):
            shape=frame.f_locals.get(name)
            if shape is not None and not any(shape is s for s in seen):
                seen.append(shape)
                states=[]
                for solid in shape.Solids():
                    classifier=BRepClass3d_SolidClassifier(solid.wrapped)
                    classifier.PerformInfinitePoint(1e-7)
                    states.append(str(classifier.State()))
                print(frame.f_lineno,name,shape.Volume(),shape.isValid(),states,flush=True)
                cq.exporters.export(shape,f'output/thread_{name}_{frame.f_lineno}.step')
    return trace
sys.settrace(trace)
d=metric_dims(db.one('metric_threads',diameter=12),db)
start,end=23,27.7655
s=ring(d['major'],7.24,start-.02,end)
t=thread_cut(s,d,start,end,db)
print('RESULT',s.Volume(),t.Volume())
