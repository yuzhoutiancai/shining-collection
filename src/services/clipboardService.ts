export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through to legacy mobile-browser path */ }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.append(area)
  area.select(); area.setSelectionRange(0, area.value.length)
  const copied = document.execCommand('copy')
  area.remove()
  return copied
}
