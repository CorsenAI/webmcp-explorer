// An indicative schema from static form metadata, never from filled-in values. The browser's
// own schema always wins. This scanner is not a proof of submit-handler or consent behaviour.
export function declarativeSchema(fields = []) {
  const properties = Object.create(null), required = new Set(), warnings = [];
  const groups = new Map();
  for (const field of fields) {
    if (!field.name || field.disabled) continue;
    if (!groups.has(field.name)) groups.set(field.name, []);
    groups.get(field.name).push(field);
  }
  for (const [name, group] of groups) {
    const f = group[0], type = f.type ?? 'text';
    if (['hidden', 'password', 'file', 'submit', 'reset', 'button', 'image'].includes(type)) {
      warnings.push(`${name}: ${type} is not inferred`); continue;
    }
    if (group.some(item => item.required)) required.add(name);
    let schema = { type: ['number','range'].includes(type) ? 'number' : type === 'checkbox' ? 'boolean' : 'string' };
    if (f.tag === 'select') {
      const values = (f.options ?? []).filter(o => !o.disabled).map(o => o.value);
      const item = { type: 'string', ...(values.length ? { enum: [...new Set(values)] } : {}) };
      schema = f.multiple ? { type: 'array', items: item } : item;
    } else if (type === 'radio' || (type === 'checkbox' && group.length > 1)) {
      const values = group.map(x => x.choice).filter(x => typeof x === 'string');
      if (values.length !== group.length) warnings.push(`${name}: incomplete choice values`);
      const item = { type: 'string', ...(values.length ? { enum: [...new Set(values)] } : {}) };
      schema = type === 'checkbox' ? { type: 'array', items: item, uniqueItems: true } : item;
    } else if (group.length > 1) warnings.push(`${name}: repeated controls are not fully inferred`);
    if (f.title) schema.title = f.title;
    if (f.description) schema.description = f.description;
    if (schema.type === 'string') {
      if (f.pattern) schema.pattern = f.pattern;
      for (const [attr,key] of [['minlength','minLength'],['maxlength','maxLength']]) {
        if (f[attr] !== null && f[attr] !== undefined && f[attr] !== '' && Number.isInteger(Number(f[attr])) && Number(f[attr]) >= 0) schema[key] = Number(f[attr]);
      }
      const format = {email:'email',url:'uri',date:'date',time:'time'}[type];
      if (format) schema.format = format;
    }
    if (schema.type === 'number') {
      for (const [attr,key] of [['min','minimum'],['max','maximum']]) {
        if (f[attr] !== null && f[attr] !== undefined && f[attr] !== '' && Number.isFinite(Number(f[attr]))) schema[key] = Number(f[attr]);
      }
    }
    properties[name] = schema;
  }
  return { schema: { type: 'object', properties, ...(required.size ? { required: [...required] } : {}) },
    complete: warnings.length === 0, warnings, source: 'inferred-html' };
}
