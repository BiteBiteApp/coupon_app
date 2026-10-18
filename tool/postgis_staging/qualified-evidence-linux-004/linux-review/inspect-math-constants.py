from pathlib import Path
import struct,re,json,hashlib
r=Path(__file__).resolve().parent;b=(r/'node-linux-x64').read_bytes();src=(r/'proof-input/evidence/math/node-v24.21.0-ieee754.cc').read_text()
assert b[:6]==b'\x7fELF\x02\x01'
phoff=struct.unpack_from('<Q',b,32)[0];phsize,phcount=struct.unpack_from('<HH',b,54)
loads=[]
for i in range(phcount):
 typ,flags,off,addr,_,filesize,memsize,align=struct.unpack_from('<IIQQQQQQ',b,phoff+i*phsize)
 if typ==1:loads.append((addr,off,filesize))
def at(a):
 for addr,off,size in loads:
  if addr<=a and a+8<=addr+size:return b[off+a-addr:off+a-addr+8]
 raise ValueError(hex(a))
refs=set()
for line in (r/'math-disassembly-compact.txt').read_text().splitlines():
 if '%rip)' in line:
  m=re.search(r'# 0x([0-9a-f]+)',line)
  if m:refs.add(int(m[1],16))
seen={struct.unpack('<Q',at(a))[0]:a for a in refs}
expected={}
for name in ['S1','S2','S3','S4','S5','S6','C1','C2','C3','C4','C5','C6','pio2_1','pio2_1t','pio2_2','pio2_2t']:
 m=re.search(r'\b'+name+r'\s*=.*?/\*\s*0x([0-9a-fA-F]{8}),\s*0x([0-9a-fA-F]{8})',src);assert m,name;expected[name]=int(m[1]+m[2],16)
for name in ['atanhi','atanlo','aT']:
 section=src.split('static const double '+name+'[] = {',1)[1].split('};',1)[0]
 for i,(hi,lo) in enumerate(re.findall(r'0x([0-9a-fA-F]{8}),\s*0x([0-9a-fA-F]{8})',section)):expected[f'{name}[{i}]']=int(hi+lo,16)
checks=[]
for name,bits in expected.items():
 found=bits if bits in seen else bits^(1<<63)
 assert found in seen,(name,hex(bits))
 checks.append({'name':name,'sourceBits':f'{bits:016x}','referencedAddress':hex(seen[found]),'binaryBits':f'{found:016x}','signNegatedWithSubtraction':found!=bits})
result={'kind':'ELF RIP-referenced constant equality against retained source; instruction sign use reviewed separately','nodeSha256':hashlib.sha256(b).hexdigest(),'checks':len(checks),'passed':len(checks),'constants':checks}
(r/'math-constants.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
