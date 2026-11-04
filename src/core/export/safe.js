// Data encoders shared by code and document exports. No dynamic data enters code comments.
const unsafe = /[<>&`$\u034f\u2028\u2029\p{Cf}]/gu;
// Escape each UTF-16 unit, including both halves of supplementary format characters.
const escape = ch => ch.split('').map(unit=>`\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
export const jsonText = (value, space = 0) => JSON.stringify(value, null, space).replace(unsafe, escape);
// JSON.parse preserves own __proto__ keys; an object literal would not.
export const jsData = value => `JSON.parse(${jsonText(JSON.stringify(value))})`;
export const visible = value => String(value ?? '').replace(/[\r\n\u034f\u2028\u2029\p{Cf}]/gu, escape);
export function mdCode(value) {
  const text=visible(value).replace(/\|/g,'\\|');
  const ticks='`'.repeat(Math.max(1,...(text.match(/`+/g)??[]).map(s=>s.length+1)));
  return `${ticks} ${text} ${ticks}`;
}
export const mdText = value => visible(value).replace(/[\\`*_{}\[\]()#!|<>]/g,'\\$&');
export function safeLink(url) {
  try { const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return null;
    return u.href.replace(/[()<>\\\s]/g,c=>c==='('? '%28':c===')'?'%29':encodeURIComponent(c)); } catch { return null; }
}
export function toolContract(tool) {
  return {name:tool.name,origin:tool.origin??null,title:tool.title??'',description:tool.description??'',
    schema:tool.inputSchema??null,annotations:tool.annotations??{},runtimeId:tool.runtimeId??'document',
    frame:{top:tool.frameId===0||tool.frameKey==='top',url:tool.frameUrl??null,indexPath:tool.frameIndexPath??null},
    engine:tool.executionContract?.engine??null,inventoryOnly:tool.inventoryOnly===true,overridden:tool.overridden===true};
}
