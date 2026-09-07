// ネイティブの confirm() は Tauri の WebView で不安定なことがあるので、画面内で 2 段階にする

import { useEffect, useState } from "react";

export function ConfirmButton({
  label,
  confirmLabel = "本当に実行",
  className = "btn danger small",
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);
  if (!arm) {
    return (
      <button type="button" className={className} disabled={disabled || busy} onClick={() => setArm(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="row" style={{ display: "inline-flex", gap: 4 }}>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArm(false);
          }
        }}
      >
        {busy ? "…" : confirmLabel}
      </button>
      <button type="button" className="btn secondary small" disabled={busy} onClick={() => setArm(false)}>取消</button>
    </span>
  );
}
