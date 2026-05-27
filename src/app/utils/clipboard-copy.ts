/**
 * Cross-browser copy (iOS Safari, HTTP dev hosts, mat-menu dismiss).
 * Prefer navigator.clipboard; fallback to textarea + execCommand.
 */
export function copyTextToClipboard(text: string): Promise<void> {
  if (!text) {
    return Promise.reject(new Error('copyTextToClipboard: empty text'));
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
  }

  return copyTextFallback(text);
}

function copyTextFallback(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('copyTextFallback: no document'));
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '2em';
    textarea.style.height = '2em';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const savedRanges: Range[] = [];
    if (selection) {
      for (let i = 0; i < selection.rangeCount; i++) {
        savedRanges.push(selection.getRangeAt(i));
      }
    }

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }

    document.body.removeChild(textarea);

    if (selection) {
      selection.removeAllRanges();
      savedRanges.forEach((range) => selection.addRange(range));
    }

    if (ok) {
      resolve();
    } else {
      reject(new Error('copyTextFallback: execCommand failed'));
    }
  });
}
