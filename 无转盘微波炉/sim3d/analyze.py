import numpy as np, sys
from scipy import ndimage as ndi
DX=4.0; X0=-230; Y0=-182; CX=-66; CY=-8
def load(fn):
    h=np.fromfile(fn,dtype=np.int32,count=8); Nx,Ny,Nz,na,kf0,kf1,kh,jv=h
    d=np.fromfile(fn,dtype=np.float32,offset=32)
    s=Nx*Ny*2+Nx*Nz
    n=len(d)//s
    d=d[:n*s].reshape(n,s)
    P=d[:,:Nx*Ny].reshape(n,Nx,Ny); H=d[:,Nx*Ny:2*Nx*Ny].reshape(n,Nx,Ny); V=d[:,2*Nx*Ny:].reshape(n,Nx,Nz)
    return dict(P=P,H=H,V=V,Nx=Nx,Ny=Ny,Nz=Nz,n=n,hdr=h,dx=min((4.0,3.0,2.0),key=lambda d:abs(d-476.0/Nx)))
def food_mask(D,kind,w,h,fx=0,fy=0):
    dx=D.get('dx',DX)
    x=X0+(np.arange(D['Nx'])+.5)*dx-CX-fx; y=Y0+(np.arange(D['Ny'])+.5)*dx-CY-fy
    X,Y=np.meshgrid(x,y,indexing='ij')
    return (X*X+Y*Y<=w*w/4) if kind=='disc' else (abs(X)<=w/2)&(abs(Y)<=h/2)
def rot_back(p,deg,dx=DX):
    # 把腔体系的功率图转回食物系：绕腔体中心旋转 -theta
    ic=(CX-X0)/dx-.5; jc=(CY-Y0)/dx-.5
    th=np.deg2rad(deg); c,s=np.cos(th),np.sin(th)
    ii,jj=np.meshgrid(np.arange(p.shape[0]),np.arange(p.shape[1]),indexing='ij')
    u=ii-ic; v=jj-jc
    x=c*u-s*v+ic; y=s*u+c*v+jc
    return ndi.map_coordinates(p,[x,y],order=1,mode='constant')
def stat(h,m):
    v=h[m]; mean=v.mean(); r=v/mean
    return dict(cv=v.std()/mean, cold=(r<.5).mean(), hot=(r>1.5).mean(), lo=r.min(), hi=r.max())
def fmt(s): return f"CV {s['cv']*100:5.1f}%  冷区<0.5 {s['cold']*100:5.1f}%  热区>1.5 {s['hot']*100:5.1f}%  min {s['lo']:.2f}  max {s['hi']:.2f}"
def report(fn,kind,w,h,fx=0,fy=0,turntable=False):
    D=load(fn); m=food_mask(D,kind,w,h,fx,fy); n=D['n']
    P=D['P']
    tot=P.reshape(n,-1).sum(1)
    print(f"[{fn}] angles {n}  P mean {tot.mean():.4g}  P min/max {tot.min()/tot.mean():.2f}/{tot.max()/tot.mean():.2f}")
    if turntable:
        Q=np.array([rot_back(P[a],360*a/n,D['dx']) for a in range(n)])
    else:
        Q=P.copy()
    # 恒功率：每个角度吸收的总功率归一（磁控管近似恒功率源）
    Qn=Q/ (Q.reshape(n,-1).sum(1)[:,None,None])
    single=[stat(Qn[a],m)['cv'] for a in range(n)]
    print("  单个固定角 CV: min %.0f%% 中位 %.0f%% max %.0f%%"%(100*min(single),100*np.median(single),100*max(single)))
    print("  全程累计(恒功率):",fmt(stat(Qn.sum(0),m)))
    print("  全程累计(恒流源):",fmt(stat(Q.sum(0),m)))
    return D,Qn,m
if __name__=='__main__':
    pass
