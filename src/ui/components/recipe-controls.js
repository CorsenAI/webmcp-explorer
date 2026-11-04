import { el, t } from '../dom.js';
export const rt = (key, args) => t(`recipes_${key}`, args?.map(String));
export const recipeMessage = async (type, data = {}) => {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (result?.error) throw Error(result.error);
  return result;
};
export function recipeButton(key, action, fail = () => {}, props = {}) {
  const button = el('button', { type:'button', text:rt(key), title:rt(key+'Help'), 'data-recipe-action':key, ...props });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await action(); } catch (error) { fail(String(error?.message ?? error)); }
    finally { button.disabled = false; }
  });
  return button;
}
export function recipeField(key, control) {
  control.setAttribute('aria-label',rt(key));control.title=rt(key+'Help');
  return el('label', { class:'recipe-field' }, [el('span',{text:rt(key)}),control]);
}
export function recipeDisclosure(key, children = []) {
  return el('details',{'data-recipe-disclosure':key},[el('summary',{text:rt(key),title:rt(key+'Help')}),...children]);
}
