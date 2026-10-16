import { useEffect, useState } from 'react';

// Ordinal ramp for distance from the photodamaged cell (10 → 80 µm).
// The ring closest to the damage is the most salient in both modes.
// Both ramps validated with the dataviz palette checker (--ordinal).
const RAMP_LIGHT = ['#002d07', '#004018', '#0c532a', '#24673c', '#397c4e', '#4f9162', '#65a778', '#7cbc8d'];
const RAMP_DARK = ['#abffc1', '#95ebad', '#80d799', '#6bc385', '#56b072', '#409d5f', '#278a4d', '#09773c'];
// Categorical slots 1–4 (blue, orange, aqua, yellow), light / dark steps.
const CAT_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const CAT_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500'];

export function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ringColors(): string[] { return isDark() ? RAMP_DARK : RAMP_LIGHT; }
export function catColors(): string[] { return isDark() ? CAT_DARK : CAT_LIGHT; }

export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'),
    grid: v('--grid'), axis: v('--axis'), panel: v('--panel'),
    accent: v('--accent'), ghost: v('--ghost'),
    fontUi: v('--font-ui') || 'sans-serif',
  };
}

/** Bumps when the colour scheme changes so canvases redraw. */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setV((x) => x + 1);
    mq.addEventListener('change', on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', on); mo.disconnect(); };
  }, []);
  return v;
}
