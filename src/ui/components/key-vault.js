import { el, t } from '../dom.js';

export function vaultControls(state, onChange) {
  const encrypted = state?.mode === 'encrypted';
  const passphrase = el('input', {type:'password',id:'vault-passphrase',autocomplete:'off',
    placeholder:t('vault_passphrase'),title:t('vault_passphraseHelp'),'aria-label':t('vault_passphrase')});
  const status = el('p',{class:'field-note',role:'status',hidden:true});
  const buttons = el('div',{class:'form-actions'});
  const act = async (type, fields={}) => {
    buttons.querySelectorAll('button').forEach(b=>{b.disabled=true;});
    try {
      const out=await chrome.runtime.sendMessage({type,passphrase:passphrase.value,...fields});
      if(out?.error){status.hidden=false;status.textContent=t('vault_error');return false;}
      await onChange({});return true;
    } catch {status.hidden=false;status.textContent=t('vault_error');return false;}
    finally {passphrase.value='';buttons.querySelectorAll('button').forEach(b=>{b.disabled=false;});}
  };
  const add=(id,key,type)=>{
    const help = key === 'vault_lock' ? 'vault_lockHelp' : key === 'vault_session' ? 'vault_sessionModeHelp' : key === 'vault_unlock' ? 'vault_passphraseHelp' : 'vault_help';
    const button=el('button',{id,text:t(key),title:t(help)});
    button.addEventListener('click',()=>act(type));buttons.append(button);
  };
  if(!encrypted)add('vault-create','vault_create','agent-vault-create');
  else {
    if(state.locked)add('vault-unlock','vault_unlock','agent-vault-unlock');
    else add('vault-lock','vault_lock','agent-vault-lock');
    add('vault-session','vault_session','agent-vault-session');
    const reset=el('button',{id:'vault-reset',text:t('vault_delete'),title:t('vault_deleteHelp')});
    let armed=false,timer;
    reset.addEventListener('click',()=>{
      if(!armed){armed=true;reset.textContent=t('vault_confirmDelete');timer=setTimeout(()=>{armed=false;reset.textContent=t('vault_delete');},4000);return;}
      clearTimeout(timer);armed=false;act('agent-vault-reset');
    });buttons.append(reset);
  }
  const node=el('details',{class:'field vault-controls'},[
    el('summary',{text:t(encrypted?(state.locked?'vault_locked':'vault_unlocked'):'vault_optional'),title:t('vault_help')}),
    el('p',{class:'field-desc',text:t('vault_help')}),
    el('label',{class:'field-label',for:'vault-passphrase',text:t('vault_passphrase')}),passphrase,
    el('p',{class:'field-desc',text:t('vault_passphraseHelp')}),buttons,status,
  ]);
  if(encrypted)node.open=true;
  return {node,act};
}

export function renderKeyVault(provider,key,onChange) {
  const vault=vaultControls(key,onChange);
  const input=el('input',{type:'password',id:'ag-key',class:'mono',autocomplete:'off',
    placeholder:key.hasKey?t('agentSetup_aKeyIsStoredType'):t('agentSetup_pasteYourApiKey')});
  const save=el('button',{id:'ag-save-key',class:'primary',text:t('agentSetup_saveKey'),title:t('help_saveKey')});
  save.addEventListener('click',async()=>{
    if(!input.value.trim()||save.disabled)return;save.disabled=true;
    try {await vault.act('agent-key-set',{providerId:provider.id,key:input.value.trim()});}
    finally {input.value='';save.disabled=false;}
  });
  const forget=el('button',{id:'ag-forget-key',text:t('agentSetup_forget'),title:t('agentSetup_deleteTheStoredKey')});
  forget.disabled=!key.hasKey;
  forget.addEventListener('click',()=>vault.act('agent-key-clear',{providerId:provider.id}));
  return el('div',{class:'field'},[
    el('label',{class:'field-label',for:'ag-key',text:t('agentSetup_apiKey')}),
    el('p',{class:'field-desc',text:t(key.hasKey?'vault_keyAvailable':'agentSetup_noKey')}),
    input,el('div',{class:'form-actions'},[save,forget]),
    el('p',{class:'field-desc',text:t('vault_sessionHelp')}),vault.node,
  ]);
}

export async function renderVaultSettings(root) {
  const state=await chrome.runtime.sendMessage({type:'agent-vault-status'});
  if(state?.error)return;
  root.replaceChildren(vaultControls(state,()=>renderVaultSettings(root)).node);
}
