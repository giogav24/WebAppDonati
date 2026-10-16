import { useId } from 'react';

interface SliderProps {
  label: string;
  symbol: string;
  unit: string;
  value: number;
  def: number;
  min: number;
  max: number;
  log?: boolean;
  onChange: (v: number) => void;
}

const fmtVal = (v: number) =>
  v === 0 ? '0' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US')
    : Math.abs(v) >= 10 ? (+v.toPrecision(3)).toString() : (+v.toPrecision(3)).toString();

export function Slider({ label, symbol, unit, value, def, min, max, log, onChange }: SliderProps) {
  const id = useId();
  const N = 1000;
  const toPos = (v: number) => log ? (Math.log(v / min) / Math.log(max / min)) * N : ((v - min) / (max - min)) * N;
  const fromPos = (p: number) => {
    const raw = log ? min * Math.pow(max / min, p / N) : min + (p / N) * (max - min);
    return +raw.toPrecision(3);
  };
  const changed = Math.abs(value - def) > 1e-12 * Math.max(1, Math.abs(def));
  return (
    <div className={'slider' + (changed ? ' changed' : '')}>
      <label htmlFor={id}>
        <span className="slider-label">{label}</span>
        <span className="slider-sym" dangerouslySetInnerHTML={{ __html: symbol }} />
      </label>
      <input id={id} type="range" min={0} max={N} step={1}
        value={Math.round(toPos(Math.max(min, Math.min(max, value))))}
        onChange={(e) => onChange(fromPos(+e.target.value))}
        aria-valuetext={`${fmtVal(value)} ${unit}`} />
      <output>
        {fmtVal(value)}<small> {unit}</small>
        {changed && (
          <button type="button" className="reset" onClick={() => onChange(def)}
            title={`Reset to the published value, ${fmtVal(def)} ${unit}`}>
            reset
          </button>
        )}
      </output>
    </div>
  );
}

interface SegProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
