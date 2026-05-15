import { useState } from 'react';

interface AlterationActionsProps {
  onSave: () => void;
  onClear: () => void;
  onExit: () => void;
  onPrint?: () => void;
  printEnabled?: boolean;
  saveDisabled: boolean;
  saveLabel: string;
  saveErrors?: string[];
  readOnly?: boolean;
  readOnlyReason?: string;
}

export function AlterationActions({
  onSave,
  onClear,
  onExit,
  onPrint,
  printEnabled = false,
  saveDisabled,
  saveLabel,
  saveErrors = [],
  readOnly = false,
  readOnlyReason,
}: AlterationActionsProps) {
  return (
    <footer className="bg-[#F0F6FB] border-t border-[#C2D4E8] px-4 py-2 flex items-center justify-between gap-3">
      {readOnly ? (
        <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          <span aria-hidden>🔒</span>
          Read-only — alteration is {readOnlyReason ?? 'finalized'}. No further changes allowed.
        </span>
      ) : (
        <span className="text-xs font-medium text-gray-500">
          Editing — toggle Alter? to mark items.{' '}
          <kbd className="px-1.5 py-0.5 mx-0.5 rounded border border-[#C2D4E8] bg-white text-[10px] font-mono text-gray-700">F10</kbd>
          or
          <kbd className="px-1.5 py-0.5 mx-0.5 rounded border border-[#C2D4E8] bg-white text-[10px] font-mono text-gray-700">Alt+S</kbd>
          Save ·
          <kbd className="px-1.5 py-0.5 mx-0.5 rounded border border-[#C2D4E8] bg-white text-[10px] font-mono text-gray-700">Esc</kbd>
          Exit
        </span>
      )}
      <div className="flex items-center gap-2">
        <SaveButton
          label={saveLabel}
          busy={saveLabel === 'Saving…'}
          onClick={onSave}
          disabled={saveDisabled || readOnly}
          errors={
            readOnly
              ? [`Alteration is ${readOnlyReason ?? 'finalized'} — no further changes allowed.`]
              : saveErrors
          }
        />
        <SquareButton
          label="Clear"
          iconSrc="/icons/clear.png"
          onClick={onClear}
          disabled={readOnly}
          title={
            readOnly
              ? 'Alteration is finalized — nothing to clear'
              : 'Discard all unsaved changes'
          }
        />
        {printEnabled && onPrint && (
          <PrintButton onClick={onPrint} />
        )}
        <SquareButton
          label="Exit"
          iconSrc="/icons/exit.png"
          onClick={onExit}
          title="Close this voucher (Esc)"
        />
      </div>
    </footer>
  );
}

interface SaveButtonProps {
  label: string;
  busy: boolean;
  onClick: () => void;
  disabled: boolean;
  errors: string[];
}

function SaveButton({ label, busy, onClick, disabled, errors }: SaveButtonProps) {
  const [hover, setHover] = useState(false);
  const showTooltip = disabled && errors.length > 0 && hover;
  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? '' : 'Save (F10 or Alt+S)'}
        className="w-16 h-16 flex flex-col items-center justify-center gap-1 border rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[#1a5fa8] border-[#1a5fa8] text-white hover:bg-[#2980d4]"
      >
        {busy ? (
          <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : (
          <img src="/icons/save.png" alt="" className="w-7 h-7" />
        )}
        <span className="text-[11px] font-medium leading-none">{label}</span>
      </button>
      {showTooltip && (
        <div
          role="tooltip"
          className="absolute bottom-full right-0 mb-2 w-64 rounded-lg bg-gray-900 text-white shadow-xl p-3 text-xs z-30"
        >
          <p className="font-semibold mb-1.5 text-amber-300">
            Save is disabled — fix these:
          </p>
          <ul className="space-y-1 list-disc pl-4">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <span
            className="absolute -bottom-1 right-6 w-2 h-2 bg-gray-900 rotate-45"
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}

interface PrintButtonProps {
  onClick: () => void;
}

function PrintButton({ onClick }: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Print alteration slip (Ctrl+P)"
      className="w-16 h-16 flex flex-col items-center justify-center gap-1 bg-white border border-[#8BAFC8] rounded-xl hover:bg-[#E8F0F8] transition-colors"
    >
      <svg className="w-7 h-7 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
        />
      </svg>
      <span className="text-[11px] text-gray-700 font-medium leading-none">Print</span>
    </button>
  );
}

interface SquareButtonProps {
  label: string;
  iconSrc: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

function SquareButton({ label, iconSrc, onClick, disabled, title }: SquareButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-16 h-16 flex flex-col items-center justify-center gap-1 bg-white border border-[#8BAFC8] rounded-xl hover:bg-[#E8F0F8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <img src={iconSrc} alt="" className="w-7 h-7" />
      <span className="text-[11px] text-gray-700 font-medium leading-none">
        {label}
      </span>
    </button>
  );
}
