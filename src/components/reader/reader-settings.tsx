import {
  Minus,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getThemeMode, setThemeMode, type ThemeMode } from "#/lib/theme";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import {
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  MEASURE_RANGE,
  type ReaderSettings,
} from "./use-reader-settings";

interface ReaderSettingsMenuProps {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReset: () => void;
}

const THEME_OPTIONS: {
  value: ThemeMode;
  icon: typeof Sun;
  label: () => string;
}[] = [
  { value: "light", icon: Sun, label: () => m.theme_light() },
  { value: "dark", icon: Moon, label: () => m.theme_dark() },
  { value: "auto", icon: Monitor, label: () => m.theme_auto() },
];

export function ReaderSettingsMenu({
  settings,
  onChange,
  onReset,
}: ReaderSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("auto");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(getThemeMode());
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const pickTheme = (mode: ThemeMode) => {
    setTheme(mode);
    setThemeMode(mode);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={m.reader_settings()}
        aria-expanded={open}
        className="reader-tool-btn"
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span className="hidden sm:inline">{m.reader_settings()}</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label={m.reader_settings()}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="reader-popover absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72">
            <Section label={m.reader_theme()}>
              <div className="grid grid-cols-3 gap-1.5">
                {THEME_OPTIONS.map(({ value, icon: Icon, label }) => (
                  <SegButton
                    key={value}
                    active={theme === value}
                    onClick={() => pickTheme(value)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label()}
                  </SegButton>
                ))}
              </div>
            </Section>

            <Section label={m.reader_typeface()}>
              <div className="grid grid-cols-2 gap-1.5">
                <SegButton
                  active={settings.font === "serif"}
                  onClick={() => onChange({ font: "serif" })}
                >
                  <span style={{ fontFamily: "var(--reader-serif)" }}>
                    {m.reader_serif()}
                  </span>
                </SegButton>
                <SegButton
                  active={settings.font === "sans"}
                  onClick={() => onChange({ font: "sans" })}
                >
                  <span style={{ fontFamily: "var(--reader-sans)" }}>
                    {m.reader_sans()}
                  </span>
                </SegButton>
              </div>
            </Section>

            <Section label={m.reader_font_size()}>
              <Stepper
                value={settings.fontSize}
                display={`${settings.fontSize}px`}
                min={FONT_SIZE_RANGE.min}
                max={FONT_SIZE_RANGE.max}
                step={FONT_SIZE_RANGE.step}
                onChange={(v) => onChange({ fontSize: v })}
              />
            </Section>

            <Section label={m.reader_width()}>
              <Stepper
                value={settings.measure}
                display={`${settings.measure}`}
                min={MEASURE_RANGE.min}
                max={MEASURE_RANGE.max}
                step={MEASURE_RANGE.step}
                onChange={(v) => onChange({ measure: v })}
              />
            </Section>

            <Section label={m.reader_line_height()}>
              <Stepper
                value={settings.lineHeight}
                display={settings.lineHeight.toFixed(1)}
                min={LINE_HEIGHT_RANGE.min}
                max={LINE_HEIGHT_RANGE.max}
                step={LINE_HEIGHT_RANGE.step}
                onChange={(v) =>
                  onChange({ lineHeight: Math.round(v * 10) / 10 })
                }
              />
            </Section>

            <button
              type="button"
              onClick={onReset}
              className="reader-reset-btn"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {m.reader_reset()}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="reader-popover-section">
      <span className="reader-popover-label">{label}</span>
      {children}
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("reader-seg", active && "is-active")}
    >
      {children}
    </button>
  );
}

function Stepper({
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="reader-stepper">
      <button
        type="button"
        className="reader-stepper-btn"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label="decrease"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="reader-stepper-value">{display}</span>
      <button
        type="button"
        className="reader-stepper-btn"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        aria-label="increase"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
