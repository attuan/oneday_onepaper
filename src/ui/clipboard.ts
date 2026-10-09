/** クリップボードに書く。navigator.clipboard が使えない環境(古い WebView など)では、欄を選択して execCommand で写す */
export async function copyText(text: string, el: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!el || !el.isConnected) return false;
    el.focus();
    el.setSelectionRange(0, text.length);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}
