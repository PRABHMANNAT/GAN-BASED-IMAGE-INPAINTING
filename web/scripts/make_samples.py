"""Create original sample illustrations; no external photographs are used."""
from pathlib import Path
import math
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from inpainting import synthetic_image

folder=Path(__file__).resolve().parents[1]/'public/samples'
folder.mkdir(parents=True,exist_ok=True)

size=(1000,800)
image=Image.fromarray(synthetic_image(48,800)).resize(size,Image.Resampling.LANCZOS)
d=ImageDraw.Draw(image)
# Paving, stone joints and an original tree silhouette enrich the teaching scene.
for y in range(752,800,15):
    d.line((0,y,1000,y),fill=(97,97,80),width=1)
    for x in range(-40,1040,85):
        shift=(y//15%2)*42
        d.line((x+shift,y,x+shift-20,y+15),fill=(91,92,77),width=1)
d.line((80,730,72,610,49,535),fill=(63,67,41),width=12)
rng=np.random.default_rng(37)
for _ in range(150):
    x,y=rng.normal(65,54),rng.normal(520,57)
    r=int(rng.integers(8,30));green=int(rng.integers(57,103))
    d.ellipse((x-r,y-r,x+r,y+r),fill=(green-15,green,green-26))
image.save(folder/'facade.jpg',quality=94)

w,h=1000,800
rgb=np.zeros((h,w,3),np.uint8)
top=np.array([137,174,187]);bottom=np.array([216,219,192])
for y in range(h):
    t=min(1,y/(h*.64));rgb[y]=np.clip(top*(1-t)+bottom*t,0,255)
coast=Image.fromarray(rgb);d=ImageDraw.Draw(coast)
d.ellipse((730,105,812,187),fill=(233,222,173))
d.polygon([(0,390),(90,344),(160,363),(263,291),(385,349),(490,319),(590,380),(730,352),(900,400),(1000,375),(1000,800),(0,800)],fill=(112,144,138))
d.polygon([(0,490),(80,459),(172,432),(290,469),(400,448),(520,481),(660,449),(800,470),(1000,451),(1000,800),(0,800)],fill=(76,119,117))
d.polygon([(0,570),(110,527),(217,560),(303,544),(455,590),(610,570),(790,601),(1000,565),(1000,800),(0,800)],fill=(51,102,103))
d.polygon([(0,665),(139,603),(236,630),(332,674),(456,692),(630,702),(749,719),(1000,712),(1000,800),(0,800)],fill=(102,121,87))
d.polygon([(0,703),(139,671),(256,706),(365,721),(466,756),(554,800),(0,800)],fill=(162,153,110))
# A small seaside building and path.
d.rectangle((180,524,287,611),fill=(211,199,157));d.polygon([(166,529),(231,487),(300,529)],fill=(113,89,65))
for x in [192,253]:d.rectangle((x,550,x+18,574),fill=(62,83,77))
d.rectangle((221,572,240,611),fill=(84,91,68))
d.polygon([(225,612),(242,612),(170,800),(100,800)],fill=(191,178,132))
for _ in range(200):
    x=int(rng.integers(340,1000));y=int(rng.integers(500,700))
    d.line((x,y,x+int(rng.integers(3,18)),y),fill=(124,159,151),width=1)
arr=np.array(coast).astype(float);arr+=rng.normal(0,1.8,(h,w,1));coast=Image.fromarray(np.clip(arr,0,255).astype(np.uint8))
coast.save(folder/'coast.jpg',quality=94)
print('Created original facade and coast sample illustrations.')
