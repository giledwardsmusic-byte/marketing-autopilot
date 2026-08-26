function u24le(a,o){return a[o]|(a[o+1]<<8)|(a[o+2]<<16);}
function u32be(a,o){return ((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3];}

export function imageDimensions(bytes,mimeType=''){
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const mime=String(mimeType||'').toLowerCase();
  if((mime==='image/png'||(!mime&&a.length>=24&&a[0]===0x89&&a[1]===0x50&&a[2]===0x4e&&a[3]===0x47))&&a.length>=24){
    const width=u32be(a,16),height=u32be(a,20);
    return width&&height?{width,height}:null;
  }
  if((mime==='image/jpeg'||(!mime&&a[0]===0xff&&a[1]===0xd8))&&a.length>=4){
    let i=2;
    while(i+8<a.length){
      if(a[i]!==0xff){i++;continue;}
      while(i<a.length&&a[i]===0xff)i++;
      const marker=a[i++];
      if(marker===0xd8||marker===0xd9)continue;
      if(marker===0xda)break;
      if(i+1>=a.length)break;
      const len=(a[i]<<8)|a[i+1];
      if(len<2||i+len>a.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&len>=7){
        const height=(a[i+3]<<8)|a[i+4];
        const width=(a[i+5]<<8)|a[i+6];
        return width&&height?{width,height}:null;
      }
      i+=len;
    }
    return null;
  }
  if((mime==='image/webp'||(!mime&&a.length>=30&&String.fromCharCode(...a.slice(0,4))==='RIFF'&&String.fromCharCode(...a.slice(8,12))==='WEBP'))&&a.length>=30){
    const chunk=String.fromCharCode(...a.slice(12,16));
    if(chunk==='VP8X'&&a.length>=30){
      return {width:1+u24le(a,24),height:1+u24le(a,27)};
    }
    if(chunk==='VP8 '&&a.length>=30){
      for(let i=20;i+9<a.length;i++){
        if(a[i]===0x9d&&a[i+1]===0x01&&a[i+2]===0x2a){
          const width=(a[i+3]|(a[i+4]<<8))&0x3fff;
          const height=(a[i+5]|(a[i+6]<<8))&0x3fff;
          return width&&height?{width,height}:null;
        }
      }
    }
    if(chunk==='VP8L'&&a.length>=25&&a[20]===0x2f){
      const bits=a[21]|(a[22]<<8)|(a[23]<<16)|(a[24]<<24);
      const width=(bits&0x3fff)+1;
      const height=((bits>>>14)&0x3fff)+1;
      return {width,height};
    }
  }
  return null;
}
