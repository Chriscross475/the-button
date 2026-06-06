// A tiny top-center objective counter (e.g. "DUCKS 12 / 24"). Levels show/hide
// it; it's reset by hiding on level change.

let el: HTMLDivElement | null = null;

function element(): HTMLDivElement {
  if (!el) el = document.getElementById('counter') as HTMLDivElement;
  return el;
}

export function setCounter(text: string): void {
  const n = element();
  n.textContent = text;
  n.style.display = 'block';
}

export function hideCounter(): void {
  element().style.display = 'none';
}
