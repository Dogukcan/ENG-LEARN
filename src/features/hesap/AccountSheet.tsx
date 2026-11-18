// The account bottom sheet (hesap.html, variant 1) and the round button that opens it.
// All rules (which view, dot colour, texts) live in accountView.ts; this file only draws them.

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, DisabledReason, Sheet, TextField, cx } from "../../components/ui";
import { isCodeShape, signInWithEmail, signOut, verifyEmailCode } from "../auth/session";
import { syncEngine } from "../sync/runtime";
import { useAccount, useSyncState } from "../sync/useSync";
import { accountDot, accountPanel, cleanCodeInput, isEmailShape, relativeTimeTr, resendSecondsLeft } from "./accountView";
import type { DotTone } from "./accountView";

const DOT_CLASS: Record<DotTone, string> = {
  none: "hidden",
  ok: "block bg-positive",
  // Amber: the same hue the Okuma block uses; it reads as "waiting", not as "wrong".
  pending: "block bg-okuma-mark",
  error: "block bg-negative",
};

const PILL = "inline-flex h-7 items-center self-start rounded-[14px] px-3 text-small font-semibold";
const NOTICE = "rounded-[14px] px-4 py-3 text-small leading-[1.4]";

/** The 44px round button for Bugün's title row. Owns the open/closed state of the sheet. */
export function AccountButton() {
  const [open, setOpen] = useState(false);
  const account = useAccount();
  const sync = useSyncState();
  const [linkSent, setLinkSent] = useState(false);
  const dot = accountDot({ configured: account.configured, signedIn: account.signedIn, linkSent, sync });

  return (
    <>
      <Button
        variant="icon"
        aria-label={dot.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[22px] fill-none stroke-current stroke-[1.9] [stroke-linecap:round] [stroke-linejoin:round]">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
        <span aria-hidden="true" className={cx("absolute top-[5px] right-[5px] size-2.5 rounded-full border-2 border-surface", DOT_CLASS[dot.tone])} />
      </Button>
      <AccountSheet open={open} onClose={() => setOpen(false)} linkSent={linkSent} onLinkSentChange={setLinkSent} />
    </>
  );
}

interface AccountSheetProps {
  open: boolean;
  onClose: () => void;
  linkSent: boolean;
  onLinkSentChange: (value: boolean) => void;
}

function AccountSheet({ open, onClose, linkSent, onLinkSentChange }: AccountSheetProps) {
  // The typed address and the send time live here, above the sheet body, because the body is
  // unmounted while the sheet is closed and "link sent" must survive a close and reopen.
  const [email, setEmail] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);

  return (
    <Sheet open={open} onClose={onClose} aria-label="Hesap">
      <AccountBody
        onClose={onClose}
        email={email}
        onEmailChange={setEmail}
        linkSent={linkSent}
        sentAt={sentAt}
        onSent={(at) => {
          setSentAt(at);
          onLinkSentChange(true);
        }}
        onUseOtherEmail={() => {
          setSentAt(null);
          setEmail("");
          onLinkSentChange(false);
        }}
      />
    </Sheet>
  );
}

interface AccountBodyProps {
  onClose: () => void;
  email: string;
  onEmailChange: (value: string) => void;
  linkSent: boolean;
  sentAt: number | null;
  onSent: (at: number) => void;
  onUseOtherEmail: () => void;
}

function AccountBody({ onClose, email, onEmailChange, linkSent, sentAt, onSent, onUseOtherEmail }: AccountBodyProps) {
  const account = useAccount();
  const sync = useSyncState();
  const panel = accountPanel({ configured: account.configured, signedIn: account.signedIn, linkSent, sync });

  const titleRef = useRef<HTMLHeadingElement>(null);
  const [emailError, setEmailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

  // A one-second clock only while it is needed (the resend countdown and "az önce" texts).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // The draft puts focus on the title when the sheet opens, so a screen reader starts at "Hesap".
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    if (confirmingSignOut) cancelRef.current?.focus();
  }, [confirmingSignOut]);

  const send = async (address: string): Promise<boolean> => {
    setBusy(true);
    setMessage("");
    const result = await signInWithEmail(address);
    setBusy(false);
    if (result.ok) {
      onSent(Date.now());
      return true;
    }
    if (result.reason === "invalid-email") setEmailError("Geçerli bir e-posta yaz.");
    else setMessage(result.message);
    return false;
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isEmailShape(email)) {
      setEmailError("Geçerli bir e-posta yaz.");
      return;
    }
    setEmailError("");
    void send(email.trim());
  };

  const onVerify = async (event: FormEvent) => {
    event.preventDefault();
    if (!isCodeShape(code)) {
      setCodeError("6 haneli kodu yaz.");
      return;
    }
    setCodeError("");
    setMessage("");
    setBusy(true);
    const result = await verifyEmailCode(email, code);
    setBusy(false);
    // On success the auth listener flips the view to "signed in" by itself.
    if (result.ok) setCode("");
    else if (result.reason === "invalid-code") setCodeError("6 haneli kodu yaz.");
    else setMessage("Kod yanlış ya da süresi dolmuş. Yeni kod iste.");
  };

  const decide = async (choice: "clear" | "keep") => {
    setBusy(true);
    await syncEngine.confirmUserSwitch(choice);
    setBusy(false);
  };

  const doSignOut = async () => {
    setBusy(true);
    const result = await signOut();
    setBusy(false);
    setConfirmingSignOut(false);
    // On success the auth listener flips the view to "signed out" by itself. Local data stays.
    if (result.ok) onUseOtherEmail();
    else setMessage(result.message);
  };

  const resendLeft = sentAt === null ? 0 : resendSecondsLeft(sentAt, nowMs);
  const syncing = sync.status === "syncing";
  const offline = sync.status === "offline";
  const syncDisabled = offline || syncing;

  return (
    <>
      <div aria-hidden="true" className="mx-auto -mt-1.5 h-1 w-9 rounded-sm bg-control" />
      <div className="flex items-center justify-between gap-3">
        <Button variant="text" onClick={onClose}>
          Kapat
        </Button>
        <h2 ref={titleRef} tabIndex={-1} className="text-section leading-[1.25] font-semibold outline-none">
          Hesap
        </h2>
        <span aria-hidden="true" className="w-[68px]" />
      </div>

      <div className="flex flex-col gap-3.5">
        {panel === "off" ? (
          <>
            <span className={cx(PILL, "bg-pill-neutral-bg text-pill-neutral-ink")}>Kapalı</span>
            <p className="text-body leading-[1.3] font-semibold">Bulut eşitleme kapalı.</p>
            <p className="text-small leading-[1.4] text-muted">
              Kurulum:{" "}
              <code className="rounded-md bg-pill-neutral-bg px-1.5 py-px font-mono text-[13px] text-pill-neutral-ink">
                supabase/README.md
              </code>
            </p>
            <p className="text-small leading-[1.4] text-muted">Uygulama bu cihazda çalışmaya devam eder. Hiçbir şey kaybolmaz.</p>
          </>
        ) : null}

        {panel === "out" ? (
          <>
            <div>
              <p className="text-body leading-[1.3] font-semibold">Bulut eşitleme</p>
              <p className="mt-1 text-small leading-[1.4] text-muted">Giriş için e-postana 6 haneli bir kod göndeririz. Şifre yok.</p>
            </div>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
              <TextField
                label="E-posta"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="ad@ornek.com"
                textSize="large"
                value={email}
                error={emailError}
                onChange={(event) => onEmailChange(event.target.value)}
              />
              <Button type="submit" variant="primary-block" block="kelime" disabled={busy}>
                {busy ? "Gönderiliyor…" : "Kod gönder"}
              </Button>
            </form>
            {message ? (
              <p role="alert" className={cx(NOTICE, "bg-pill-negative-bg text-pill-negative-ink")}>
                {message}
              </p>
            ) : null}
            <p className="text-small leading-[1.4] text-muted">Sadece uygulamanın sahibinin e-postası çalışır. Yeni hesap açılamaz.</p>
          </>
        ) : null}

        {panel === "sent" ? (
          <>
            <div>
              <p className="text-body leading-[1.3] font-semibold">Kod yolda</p>
              <p role="status" className="mt-1 text-small leading-[1.4] break-words text-muted">
                <strong className="font-semibold text-text">{email.trim()}</strong> adresine 6 haneli kod gönderdik. Maildeki kodu buraya yaz.
              </p>
            </div>
            <form onSubmit={(event) => void onVerify(event)} noValidate className="flex flex-col gap-3.5">
              <TextField
                label="Maildeki kod"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="123456"
                maxLength={7}
                textSize="large"
                className="num tracking-[0.2em]"
                value={code}
                error={codeError}
                onChange={(event) => setCode(cleanCodeInput(event.target.value))}
              />
              <Button type="submit" variant="primary-block" block="kelime" disabled={busy}>
                {busy ? "Kontrol ediliyor…" : "Giriş yap"}
              </Button>
            </form>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="neutral"
                disabled={resendLeft > 0 || busy}
                onClick={() => void send(email.trim())}
                className="text-small"
              >
                {resendLeft > 0 ? (
                  <>
                    Tekrar gönder (<span className="num">{resendLeft}</span> sn)
                  </>
                ) : (
                  "Tekrar gönder"
                )}
              </Button>
              <Button variant="neutral" onClick={onUseOtherEmail} className="text-small">
                Başka e-posta
              </Button>
            </div>
            {message ? (
              <p role="alert" className={cx(NOTICE, "bg-pill-negative-bg text-pill-negative-ink")}>
                {message}
              </p>
            ) : null}
            <p className="text-small leading-[1.4] text-muted">
              Mail gelmediyse gereksiz klasörüne de bak. Maildeki bağlantı da çalışır ama iPhone ana ekran uygulamasında kodu kullan.
            </p>
          </>
        ) : null}

        {panel === "switch" ? (
          <>
            <span className={cx(PILL, "bg-pill-neutral-bg text-pill-neutral-ink")}>Karar bekliyor</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-small text-muted">Yeni hesap</span>
              <span className="text-body font-semibold break-words">{account.email ?? "Giriş yapıldı"}</span>
            </div>
            <p className={cx(NOTICE, "bg-pill-neutral-bg text-pill-neutral-ink")}>
              Bu cihazda başka bir hesabın verisi var. Sormadan yüklemiyoruz. Eşitleme senin cevabına kadar durur.
            </p>
            <Button variant="primary-block" block="kelime" disabled={busy} onClick={() => void decide("clear")}>
              Cihazdaki veriyi sil, bu hesabınkini indir
            </Button>
            <p className="text-small leading-[1.4] text-muted">Silinen veri bu cihazdan geri gelmez. Önceki hesabın bulutta duran verisi yerinde kalır.</p>
            <Button variant="neutral" disabled={busy} onClick={() => void decide("keep")}>
              Cihazdaki veriyi bu hesaba yükle
            </Button>
            {message ? (
              <p role="alert" className={cx(NOTICE, "bg-pill-negative-bg text-pill-negative-ink")}>
                {message}
              </p>
            ) : null}
            <hr className="m-0 border-0 border-t border-rule" />
            <Button variant="neutral" disabled={busy} onClick={() => void doSignOut()}>
              Çıkış yap
            </Button>
          </>
        ) : null}

        {panel === "in" || panel === "pending" || panel === "error" ? (
          <>
            {panel === "in" ? (
              <span className={cx(PILL, "bg-pill-positive-bg text-pill-positive-ink")}>Bağlı</span>
            ) : panel === "pending" ? (
              <span className={cx(PILL, "bg-pill-neutral-bg text-pill-neutral-ink")}>Bekliyor</span>
            ) : (
              <span className={cx(PILL, "bg-pill-negative-bg text-pill-negative-ink")}>Hata</span>
            )}

            <div className="flex flex-col gap-0.5">
              <span className="text-small text-muted">Hesap</span>
              <span className="text-body font-semibold break-words">{account.email ?? "Giriş yapıldı"}</span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-small text-muted">Eşitleme</span>
              {panel === "in" ? (
                <span role="status" className="num text-body font-semibold">
                  Son eşitleme: {relativeTimeTr(sync.lastSyncedAt, new Date(nowMs))}
                </span>
              ) : panel === "pending" ? (
                <span className="num text-body font-semibold">
                  {sync.pendingCount > 0 ? `${sync.pendingCount} değişiklik bekliyor` : "Bekleyen değişiklik yok"}
                </span>
              ) : (
                <span className="num text-body font-semibold">
                  Son başarılı eşitleme: {relativeTimeTr(sync.lastSyncedAt, new Date(nowMs))}
                </span>
              )}
            </div>

            {panel === "pending" && offline ? (
              <p className={cx(NOTICE, "bg-pill-neutral-bg text-pill-neutral-ink")}>
                Çevrimdışısın. Bağlantı gelince otomatik eşitlenir. Değişiklikler bu cihazda duruyor.
              </p>
            ) : null}
            {panel === "error" ? (
              <p role="alert" className={cx(NOTICE, "bg-pill-negative-bg text-pill-negative-ink")}>
                Eşitleme başarısız. Değişiklikler bu cihazda güvende.
                {sync.lastError ? <span className="mt-1 block break-words opacity-80">Ayrıntı: {sync.lastError}</span> : null}
              </p>
            ) : null}

            <Button
              variant="primary-block"
              block="kelime"
              disabled={syncDisabled}
              aria-describedby={offline ? "sync-disabled-reason" : undefined}
              onClick={() => void syncEngine.syncNow()}
            >
              {syncing ? "Eşitleniyor…" : panel === "error" ? "Tekrar dene" : "Şimdi eşitle"}
            </Button>
            {offline ? <DisabledReason id="sync-disabled-reason">Çevrimdışıyken eşitlenemez.</DisabledReason> : null}

            <hr className="m-0 border-0 border-t border-rule" />

            {message ? (
              <p role="alert" className={cx(NOTICE, "bg-pill-negative-bg text-pill-negative-ink")}>
                {message}
              </p>
            ) : null}

            {confirmingSignOut ? (
              <>
                <div role="alertdialog" aria-labelledby="signout-title" className={cx(NOTICE, "bg-pill-neutral-bg text-pill-neutral-ink")}>
                  <p id="signout-title" className="text-body leading-[1.3] font-semibold">
                    Çıkış yapılsın mı?
                  </p>
                  <p className="mt-1">
                    Bu cihazdaki veriler silinmez. Eşitleme çıkış yapana kadar durur.
                    {sync.pendingCount > 0 ? ` ${sync.pendingCount} bekleyen değişiklik eşitlenmemiş kalır.` : ""}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    ref={cancelRef}
                    type="button"
                    onClick={() => setConfirmingSignOut(false)}
                    className="h-14 w-full rounded-[14px] border border-control bg-surface text-body font-semibold text-text active:bg-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={() => void doSignOut()}
                    className="h-14 w-full rounded-[14px] bg-negative text-body font-semibold text-white active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text dark:text-pill-negative-bg"
                  >
                    Çıkış yap
                  </button>
                </div>
              </>
            ) : (
              <Button variant="neutral" onClick={() => setConfirmingSignOut(true)}>
                Çıkış yap
              </Button>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
