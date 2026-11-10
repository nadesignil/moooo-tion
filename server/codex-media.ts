import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

const DOMAINS = ['magnific.com','freepik.com','freepik.es','fpikcdn.com','figma.com','figmausercontent.com','cloudfront.net','amazonaws.com','replicate.delivery'];
export const mediaUrlAllowed = (value:string) => {
  try {
    const u=new URL(value);
    return u.protocol==='https:' && !u.username && !u.password && !u.port && !isIP(u.hostname) && DOMAINS.some(d=>u.hostname===d || u.hostname.endsWith('.'+d));
  } catch {return false;}
};
export const downloadConnectorMedia = async (url:string, signal:AbortSignal) => {
  if(!mediaUrlAllowed(url)) throw new Error('Файл расположен вне поддерживаемых CDN Figma/Magnific. Импортируйте его вручную в ассеты.');
  let response:Response|undefined;
  let current=url;
  for(let redirect=0;redirect<5;redirect++) {
    if(!mediaUrlAllowed(current))throw new Error('CDN перенаправил на неподдерживаемый адрес');
    const addresses=await lookup(new URL(current).hostname,{all:true});
    if(addresses.some(a=> /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address) || /^(::1$|fe80:|fc|fd|::ffff:)/i.test(a.address))) throw new Error('Локальный сетевой адрес недоступен');
    response=await fetch(current,{signal:AbortSignal.any([signal,AbortSignal.timeout(60_000)]),redirect:'manual'});
    if(![301,302,303,307,308].includes(response.status))break;
    const location=response.headers.get('location');await response.body?.cancel();
    if(!location)throw new Error('CDN не вернул адрес файла');
    current=new URL(location,current).href;response=undefined;
  }
  if(!response)throw new Error('Слишком много перенаправлений CDN');
  if(!response.ok || !response.body) throw new Error(`Не удалось скачать ассет: HTTP ${response.status}`);
  const mime=response.headers.get('content-type')?.split(';')[0] ?? '';
  if(!/^(image|video|audio|font)\//.test(mime) && !(/^application\/(octet-stream|font-woff|x-font-ttf|x-font-opentype)$/.test(mime)&&/\.(png|jpe?g|webp|svg|ttf|otf|woff2?)$/i.test(new URL(current).pathname))) throw new Error('По ссылке нет изображения, видео или аудио');
  const limit=50*1024*1024;
  if(Number(response.headers.get('content-length'))>limit) throw new Error('Ассет больше 50MB');
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {
    for(;;) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.length; if(size>limit) throw new Error('Ассет больше 50MB'); chunks.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
};
