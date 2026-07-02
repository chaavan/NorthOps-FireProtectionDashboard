'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Outfit } from 'next/font/google';
import LoginInteractiveBackground from '@/components/login/LoginInteractiveBackground';
import BrandLogo from '@/components/BrandLogo';
import {
  getLocationSelectUrl,
  sanitizeCallbackUrl,
  softwareConfig,
} from '@/lib/softwareConfig';
import { LAST_LOCATION_KEY } from '@/lib/hooks/usePortalState';
import { removeSurveyPopupDom } from '@/lib/survey/surveySnooze';

const loginTitleFont = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

const needsLocationGate =
  softwareConfig.portalEnabled && softwareConfig.locationSelectEnabled;

const labelClass =
  'mb-2 block text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400';
const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white outline-none transition placeholder:text-slate-500 focus:border-blue-300/60 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50';
const modalCardClass =
  'w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl shadow-black/50 backdrop-blur-xl';

function LoginPageContent() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [callbackUrl, setCallbackUrl] = useState('/');
  const locationSelectUrl = getLocationSelectUrl(callbackUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);
  const resetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showContactModal, setShowContactModal] = useState(false);
  const [isPortalGateReady, setIsPortalGateReady] = useState(!needsLocationGate);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('callbackUrl');
    setCallbackUrl(sanitizeCallbackUrl(raw));
  }, []);

  useEffect(() => {
    removeSurveyPopupDom();
    setShowResetModal(false);
    setShowContactModal(false);

    return () => {
      if (resetCloseTimerRef.current) {
        clearTimeout(resetCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!needsLocationGate) {
      setIsPortalGateReady(true);
      return;
    }

    if (sessionStatus === 'loading') return;

    if (sessionStatus === 'authenticated') {
      setIsPortalGateReady(true);
      return;
    }

    let hasSelectedLocation = false;
    try {
      hasSelectedLocation = Boolean(
        window.localStorage.getItem(LAST_LOCATION_KEY),
      );
    } catch {
      hasSelectedLocation = false;
    }

    if (!hasSelectedLocation) {
      router.replace(locationSelectUrl);
      return;
    }

    setIsPortalGateReady(true);
  }, [locationSelectUrl, router, sessionStatus]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    router.replace(callbackUrl);
    router.refresh();
  }, [callbackUrl, router, sessionStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid email or password');
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetSuccess('');

    if (resetPassword !== resetPasswordConfirm) {
      setResetError('Passwords do not match');
      return;
    }

    if (resetPassword.length < 8) {
      setResetError('Password must be at least 8 characters long');
      return;
    }

    setIsSubmittingReset(true);

    try {
      const response = await fetch('/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: resetEmail,
          newPassword: resetPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit password reset request');
      }

      setResetSuccess(data.message);
      setResetEmail('');
      setResetPassword('');
      setResetPasswordConfirm('');
      setShowResetModal(false);

      if (resetCloseTimerRef.current) {
        clearTimeout(resetCloseTimerRef.current);
      }
      resetCloseTimerRef.current = setTimeout(() => {
        setResetSuccess('');
        resetCloseTimerRef.current = null;
      }, 8000);
    } catch (err) {
      setResetError((err as Error).message);
    } finally {
      setIsSubmittingReset(false);
    }
  };

  const closeResetModal = () => {
    if (resetCloseTimerRef.current) {
      clearTimeout(resetCloseTimerRef.current);
      resetCloseTimerRef.current = null;
    }
    setShowResetModal(false);
    setResetEmail('');
    setResetPassword('');
    setResetPasswordConfirm('');
    setResetError('');
    setResetSuccess('');
  };

  useEffect(() => {
    if (!showResetModal && !showContactModal) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showContactModal) {
        setShowContactModal(false);
      } else {
        closeResetModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showResetModal, showContactModal]);

  if (needsLocationGate && (sessionStatus === 'loading' || !isPortalGateReady)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <LoginInteractiveBackground />

      <div className="absolute left-4 top-4 z-[120] sm:left-6 sm:top-6">
        {softwareConfig.locationSelectEnabled ? (
        <Link
          href={locationSelectUrl}
          className="relative z-[120] inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/55 px-3 py-2 text-sm font-medium text-slate-400 shadow-xl shadow-black/30 backdrop-blur-xl transition hover:border-blue-300/30 hover:text-blue-200"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Change location
        </Link>
        ) : null}
      </div>

      <div className="relative z-[110] flex min-h-screen items-center justify-center p-4 py-10 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md">
          <div
            className={`${loginTitleFont.className} mb-8 flex flex-col items-center gap-5 text-center sm:gap-6`}
          >
            <BrandLogo
              variant="on-dark"
              className="mx-auto h-20 w-auto max-w-[min(100%,24rem)] object-center sm:h-24"
            />
            <h1 className="text-[1.75rem] font-semibold tracking-[0.04em] text-white sm:text-[2rem]">
              {softwareConfig.name}
            </h1>
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.34em] text-slate-400">
              {softwareConfig.tagline}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/75 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-10">
            {resetSuccess ? (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-emerald-200">
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="text-sm font-medium">{resetSuccess}</p>
              </div>
            ) : null}

            {error ? (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-red-200">
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm font-medium">{error}</p>
            </div>
          ) : null}

            <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className={labelClass}>
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                className={inputClass}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="password" className={labelClass + ' mb-0'}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email);
                    setResetError('');
                    setShowResetModal(true);
                  }}
                  className="text-[11px] font-semibold uppercase tracking-wide text-blue-300 transition hover:text-blue-200"
                >
                  Forgot password?
                </button>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                className={inputClass}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-300/30 bg-blue-500/20 py-3.5 text-sm font-bold text-blue-100 transition hover:border-blue-300/50 hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <span className="transition group-hover:translate-x-0.5">
                    &rarr;
                  </span>
                </>
              )}
            </button>
            </form>
          </div>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setShowContactModal(true)}
              className="text-sm font-medium text-slate-500 transition hover:text-slate-300"
            >
              Need access? Contact your administrator
            </button>
          </div>
        </div>
      </div>

      {showResetModal ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
          role="presentation"
          onClick={() => {
            if (!isSubmittingReset) closeResetModal();
          }}
        >
          <div
            className={modalCardClass}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="reset-password-title" className="text-xl font-black text-white">
              Reset password
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Enter your email and new password. An administrator will review
              and approve your request.
            </p>

            {resetError ? (
              <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">
                {resetError}
              </div>
            ) : null}

            <form
              onSubmit={handlePasswordResetRequest}
              className="mt-6 space-y-4"
            >
              <div>
                <label className={labelClass}>Email address</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  className={inputClass}
                  placeholder="your.email@example.com"
                />
              </div>
              <div>
                <label className={labelClass}>
                  New password (min 8 characters)
                </label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  required
                  minLength={8}
                  className={inputClass}
                  placeholder="Enter new password"
                />
              </div>
              <div>
                <label className={labelClass}>Confirm new password</label>
                <input
                  type="password"
                  value={resetPasswordConfirm}
                  onChange={(e) => setResetPasswordConfirm(e.target.value)}
                  required
                  minLength={8}
                  className={inputClass}
                  placeholder="Confirm new password"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeResetModal}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
                  disabled={isSubmittingReset}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl border border-blue-300/30 bg-blue-500/20 py-2.5 text-sm font-bold text-blue-100 transition hover:bg-blue-500/30 disabled:opacity-50"
                  disabled={isSubmittingReset}
                >
                  {isSubmittingReset ? 'Submitting...' : 'Submit request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showContactModal ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
          role="presentation"
          onClick={() => setShowContactModal(false)}
        >
          <div
            className={modalCardClass}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-xl font-black text-white">
              Contact administrators
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              For access requests or support, contact one of the developers:
            </p>

            <div className="mt-6 space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold text-white">Curran Advani</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Developer
                    </p>
                  </div>
                  <a
                    href="tel:+12084243349"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300/30 bg-blue-500/15 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/25"
                  >
                    +1 (208) 424-3349
                  </a>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold text-white">Chaavan Sure</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Developer
                    </p>
                  </div>
                  <a
                    href="tel:+18583055670"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300/30 bg-blue-500/15 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/25"
                  >
                    +1 (858) 305-5670
                  </a>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowContactModal(false)}
              className="mt-6 w-full rounded-xl border border-blue-300/30 bg-blue-500/20 py-2.5 text-sm font-bold text-blue-100 transition hover:bg-blue-500/30"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageContent />;
}
