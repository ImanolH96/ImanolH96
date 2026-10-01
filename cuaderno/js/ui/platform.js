import { h } from '../core/dom.js';

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = h('textarea', { value: text, style: 'position:fixed;top:0;left:0;opacity:0' });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
    return ok;
  }
}

// Opens the system share sheet (on iPhone: "Guardar en Archivos"). Some browsers refuse files of a type
// they don't know (e.g. text/markdown), so text files are retried as text/plain with the same name.
export async function saveFile(name, blob) {
  const types = [blob.type, blob.type.startsWith('text/') || blob.type === 'application/json' ? 'text/plain' : null];
  for (const type of types.filter((t, i) => t && types.indexOf(t) === i)) {
    try {
      const file = new File([blob], name, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

export const fmtDate = (iso) => {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
};
