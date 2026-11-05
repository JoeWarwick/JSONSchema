import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useT } from '../i18n';
import { getAuthSession, googleRedirectUrl, submitAuth, type AuthSession } from '../utils/auth-client';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from './ui/dialog/dialog';
import styles from './account-dialog.module.css';

type View = 'login' | 'register' | 'forgot' | 'reset' | 'confirm';
interface EmailLink { email: string; userId: string; token: string }

export function AccountDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [link, setLink] = useState<EmailLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const action = url.searchParams.get('auth');
    if (!['confirm-email', 'reset-password', 'google-success', 'google-error'].includes(action ?? '')) return;
    const emailLink = {
      email: url.searchParams.get('email') ?? '',
      userId: url.searchParams.get('userId') ?? '',
      token: url.searchParams.get('token') ?? '',
    };
    // Remove one-time credentials from browser history before requesting any account data.
    for (const key of ['auth', 'email', 'userId', 'token']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (action === 'confirm-email' || action === 'reset-password') {
      setLink(emailLink);
      setEmail(emailLink.email);
      setView(action === 'confirm-email' ? 'confirm' : 'reset');
    } else if (action === 'google-success') {
      toast.success(t('auth.googleSuccess'));
      return;
    } else {
      setError(t('auth.googleError'));
    }
    setOpen(true);
  }, [t]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    getAuthSession(controller.signal).then(value => {
      setSession(value);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      console.error('Failed to load account session:', failure);
      setError(t('auth.unavailable'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open, t]);

  const changeView = (next: View) => {
    setView(next);
    setPassword('');
    setNewPassword('');
    if (session) setError(null);
    setNotice(null);
  };

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setPassword('');
      setNewPassword('');
    } catch (failure) {
      console.error('Account operation failed:', failure);
      setError(failure instanceof Error ? failure.message : t('auth.failed'));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => setSession(await getAuthSession());
  const google = (mode: 'login' | 'link') => run(async () => {
    const result = await submitAuth('google/start', { mode, password });
    window.location.assign(googleRedirectUrl(result));
  });
  const user = session?.user;
  const linkedFlow = view === 'confirm' || view === 'reset';
  const disabled = busy || loading || !session;

  const submit = () => run(async () => {
    if (view === 'confirm') {
      await submitAuth('confirm-email', { userId: link?.userId ?? '', token: link?.token ?? '' });
      setLink(null);
      setView('login');
      setNotice(t('auth.confirmed'));
    } else if (view === 'reset') {
      await submitAuth('reset-password', { email, token: link?.token ?? '', password: newPassword });
      setLink(null);
      setView('login');
      setNotice(t('auth.passwordReset'));
    } else if (view === 'register') {
      await submitAuth('register', { email, password });
      setView('login');
      setNotice(t('auth.checkConfirmation'));
    } else if (view === 'forgot') {
      await submitAuth('forgot-password', { email });
      setNotice(t('auth.checkReset'));
    } else {
      await submitAuth('login', { email, password });
    }
    await refresh();
    if (view === 'login') {
      setOpen(false);
      toast.success(t('auth.signInSuccess'));
    }
  });

  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setPassword('');
      setNewPassword('');
      setError(null);
      setNotice(null);
    }
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button className={styles.trigger}>{t('auth.account')}</button></DialogTrigger>
    <DialogContent className={styles.dialog} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{t('auth.account')}</DialogTitle></DialogHeader>
      <DialogDescription>{t('auth.localHint')}</DialogDescription>
      {loading && <p role="status">{t('common.loading')}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!loading && !session && <button disabled={busy} onClick={() => void run(refresh)}>{t('auth.retry')}</button>}
      {user && !linkedFlow ? <div className={styles.body}>
        <p>{t('auth.signedIn', { email: user.email })}</p>
        <p>{user.emailConfirmed ? t('auth.emailVerified') : t('auth.emailUnverified')}</p>
        {!user.emailConfirmed && <button disabled={disabled} onClick={() => void run(async () => {
          await submitAuth('resend-confirmation', { email: user.email });
          setNotice(t('auth.checkConfirmation'));
        })}>{t('auth.resend')}</button>}
        <form id="account-password-form" autoComplete="on" className={styles.form} onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            await submitAuth('password', { currentPassword: password, newPassword });
            await refresh();
            setNotice(t('auth.passwordSaved'));
          });
        }}>
          <h3>{user.hasPassword ? t('auth.changePassword') : t('auth.setPassword')}</h3>
          <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
          {user.hasPassword && <label>{t('auth.currentPassword')}
            <input id="account-current-password" name="current-password" type="password" autoComplete="current-password" required value={password}
              disabled={busy} onChange={event => setPassword(event.target.value)} />
          </label>}
          <label>{t('auth.newPassword')}
            <input id="account-new-password" name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
              value={newPassword} disabled={busy} onChange={event => setNewPassword(event.target.value)} />
          </label>
          <p className={styles.hint}>{t('auth.passwordHint')}</p>
          <button type="submit" disabled={disabled}>{t('auth.savePassword')}</button>
        </form>
        <section className={styles.body} aria-label={t('auth.google')}>
          <h3>{t('auth.google')}</h3>
          <p>{user.hasGoogleLogin ? t('auth.googleLinked') : t('auth.googleNotLinked')}</p>
          {session.googleEnabled && !user.hasGoogleLogin && <button disabled={disabled || (user.hasPassword && !password)}
            onClick={() => void google('link')}>{t('auth.linkGoogle')}</button>}
          {user.hasGoogleLogin && <button disabled={disabled || !user.hasPassword || !password}
            onClick={() => void run(async () => {
              await submitAuth('google/unlink', { password });
              await refresh();
              setNotice(t('auth.googleUnlinked'));
            })}>{t('auth.unlinkGoogle')}</button>}
          <p className={styles.hint}>{t(user.hasPassword ? 'auth.linkPasswordHint' : 'auth.lastMethodHint')}</p>
          {!session.googleEnabled && <p>{t('auth.googleUnavailable')}</p>}
        </section>
        <button disabled={disabled} onClick={() => void run(async () => {
          await submitAuth('logout', {});
          setSession(null);
          setView('login');
          await refresh();
          setNotice(t('auth.signedOut'));
        })}>{t('auth.signOut')}</button>
      </div> : <div className={styles.body}>
        <h3>{t(`auth.views.${view}`)}</h3>
        <form key={view} id={`account-${view}-form`} autoComplete="on" className={styles.form}
          onInvalidCapture={event => {
            const field = event.target;
            if (field instanceof HTMLInputElement) {
              setError(t('auth.invalidField', {
                field: field.labels?.[0]?.textContent ?? field.name,
                message: field.validationMessage,
              }));
            }
          }}
          onSubmit={event => { event.preventDefault(); void submit(); }}>
          {view !== 'confirm' && <label>{t('auth.email')}
            <input id={`account-${view}-email`} name="username" type="email" autoComplete="username" required maxLength={256} value={email}
              readOnly={view === 'reset'} disabled={busy} onChange={event => setEmail(event.target.value)} />
          </label>}
          {(view === 'login' || view === 'register') && <label>{t('auth.password')}
            <input id={`account-${view}-password`} name={view === 'login' ? 'password' : 'new-password'}
              type="password" autoComplete={view === 'login' ? 'current-password' : 'new-password'}
              required minLength={view === 'register' ? 12 : undefined} maxLength={128}
              value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
          </label>}
          {view === 'reset' && <label>{t('auth.newPassword')}
            <input id="account-reset-password" name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
              value={newPassword} disabled={busy} onChange={event => setNewPassword(event.target.value)} />
          </label>}
          {(view === 'reset' || view === 'register') && <p className={styles.hint}>{t('auth.passwordHint')}</p>}
          {view === 'confirm' && <p>{t('auth.confirmHint')}</p>}
          <button type="submit" disabled={disabled || (linkedFlow && !link?.token)}>
            {busy ? t('auth.working') : t(`auth.actions.${view}`)}
          </button>
        </form>
        {view === 'login' && <>
          {session?.googleEnabled
            ? <button disabled={disabled} onClick={() => void google('login')}>{t('auth.continueGoogle')}</button>
            : session && <p className={styles.hint}>{t('auth.googleUnavailable')}</p>}
          <div className={styles.links}>
            <button disabled={busy} onClick={() => changeView('register')}>{t('auth.createAccount')}</button>
            <button disabled={busy} onClick={() => changeView('forgot')}>{t('auth.forgotPassword')}</button>
            <button disabled={disabled || !email} onClick={() => void run(async () => {
              await submitAuth('resend-confirmation', { email });
              setNotice(t('auth.checkConfirmation'));
            })}>{t('auth.resend')}</button>
          </div>
        </>}
        {view !== 'login' && <button disabled={busy} onClick={() => {
          setLink(null);
          changeView('login');
        }}>{t('auth.backToLogin')}</button>}
      </div>}
      <DialogFooter><button disabled={busy} onClick={() => changeOpen(false)}>{t('common.close')}</button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
