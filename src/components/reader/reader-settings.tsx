import { Minus, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { TOOL_BTN } from "./reader-ui";
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

export function ReaderSettingsMenu({
  settings,
  onChange,
  onReset,
}: ReaderSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={m.reader_settings()}
        aria-expanded={open}
        className={TOOL_BTN}
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
          <div
            className={cn(
              "animate-in fade-in slide-in-from-bottom-3 duration-[180ms]",
              "absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72",
              "flex flex-col gap-[0.85rem] rounded-[16px] border border-[var(--line)] p-[0.9rem]",
              "bg-[linear-gradient(165deg,var(--surface-strong),var(--surface))]",
              "shadow-[0_16px_44px_rgba(45,42,36,0.18)] backdrop-blur-[14px]",
            )}
          >
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
              className={cn(
                "inline-flex items-center justify-center gap-[0.4rem] cursor-pointer",
                "rounded-[9px] border border-[var(--line)] bg-transparent p-[0.45rem]",
                "text-[0.78rem] font-semibold text-[var(--ink-soft)]",
                "transition-[color,border-color] duration-150",
                "hover:text-[var(--ink)] hover:border-[var(--academic-brown)]",
              )}
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
    <div className="flex flex-col gap-[0.45rem]">
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
        {label}
      </span>
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
      className={cn(
        "inline-flex items-center justify-center gap-[0.3rem] cursor-pointer",
        "rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-[0.3rem] py-[0.42rem]",
        "text-[0.8rem] font-semibold text-[var(--ink-soft)] transition-all duration-150",
        "hover:text-[var(--ink)] hover:border-[var(--academic-brown)]",
        active &&
          "text-white border-transparent shadow-[0_4px_12px_rgba(139,111,71,0.24)] bg-[linear-gradient(150deg,var(--academic-brown),var(--academic-brown-deep))]",
      )}
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
    <div className="flex items-center justify-between rounded-[9px] border border-[var(--line)] bg-[var(--surface)] p-[0.25rem]">
      <button
        type="button"
        className={STEPPER_BTN}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label="decrease"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="text-[0.85rem] font-bold tabular-nums text-[var(--ink)]">
        {display}
      </span>
      <button
        type="button"
        className={STEPPER_BTN}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        aria-label="increase"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const STEPPER_BTN = cn(
  "grid place-items-center w-[30px] h-[30px] rounded-[7px] border-0",
  "bg-transparent text-[var(--ink)] cursor-pointer transition-[background] duration-150",
  "enabled:hover:bg-[color-mix(in_srgb,var(--academic-brown)_14%,transparent)]",
  "disabled:opacity-[0.35] disabled:cursor-not-allowed",
);
