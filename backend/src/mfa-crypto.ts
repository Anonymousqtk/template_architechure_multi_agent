import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  let bits=0,value=0,result='';
  for(const byte of randomBytes(20)){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(value>>>bits)&31];}}
  return result;
}
function decode(secret:string) {
  let bits=0,value=0;const bytes:number[]=[];
  for(const char of secret){const digit=alphabet.indexOf(char);if(digit<0)throw Error('Invalid TOTP secret');value=(value<<5)|digit;bits+=5;if(bits>=8){bits-=8;bytes.push((value>>>bits)&255);}}
  return Buffer.from(bytes);
}
export function totp(secret:string,counter:number,digits=6) {
  const moving=Buffer.alloc(8);moving.writeBigUInt64BE(BigInt(counter));
  const hash=createHmac('sha1',decode(secret)).update(moving).digest();const offset=hash[hash.length-1]&15;
  return ((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).toString().padStart(digits,'0');
}
export function verifyTotp(secret:string,code:string,last:number,now=Date.now()):number|null {
  if(!/^\d{6}$/.test(code))return null;
  const current=Math.floor(now/30000);
  for(const step of [current,current-1])if(step>last&&step>=0&&timingSafeEqual(Buffer.from(totp(secret,step)),Buffer.from(code)))return step;
  return null;
}
function keyBytes(key:string) {const value=Buffer.from(key,'base64');if(value.length!==32)throw Error('MFA encryption key must be 32 bytes base64');return value;}
export function seal(secret:string,userId:string,key:string) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv);cipher.setAAD(Buffer.from(userId));
  const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return [iv,data,cipher.getAuthTag()].map(x=>x.toString('base64url')).join('.');
}
export function unseal(value:string,userId:string,key:string) {
  const [iv,data,tag]=value.split('.').map(x=>Buffer.from(x,'base64url'));const cipher=createDecipheriv('aes-256-gcm',keyBytes(key),iv);cipher.setAAD(Buffer.from(userId));cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');
}
