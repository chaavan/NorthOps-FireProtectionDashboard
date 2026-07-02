'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams?.get('error') ?? null;

  const getErrorMessage = (errorType: string | null) => {
    switch (errorType) {
      case 'Configuration':
        return 'There is a problem with the server configuration.';
      case 'AccessDenied':
        return 'You do not have permission to sign in.';
      case 'Verification':
        return 'The verification token has expired or has already been used.';
      case 'Default':
      default:
        return 'An error occurred during authentication. Please try again.';
    }
  };

  const errorMessage = getErrorMessage(error);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-200/30 rounded-full blur-3xl animate-float"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-200/30 rounded-full blur-3xl animate-float" style={{animationDelay: '1s'}}></div>
      </div>

      {/* Error Card */}
      <div className="relative w-full max-w-md">
        <div className="card-modern p-8 sm:p-10 backdrop-blur-sm border-2 border-white/50 shadow-2xl">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <div className="relative animate-pulse-glow">
              <img 
                src="/icon.png" 
                alt="Total Fire Protection" 
                className="h-20 w-20 rounded-2xl shadow-xl"
              />
            </div>
          </div>

          {/* Error Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-danger rounded-full flex items-center justify-center shadow-xl">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gradient mb-2">
              Authentication Error
            </h1>
            <p className="text-gray-600 font-medium">
              {errorMessage}
            </p>
          </div>

          {/* Error Details */}
          {error && (
            <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-800 font-semibold text-center">
                Error Code: {error}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-4">
            <Link
              href="/login"
              className="w-full btn-primary px-6 py-4 text-lg text-center block"
            >
              ← Back to Login
            </Link>
            <Link
              href="/"
              className="w-full px-6 py-4 text-lg text-center block bg-white/80 border-2 border-gray-200 rounded-xl hover:bg-white transition-all font-semibold text-gray-700"
            >
              Go to Home
            </Link>
          </div>

          {/* Footer Note */}
          <div className="mt-8 text-center">
            <p className="text-xs text-gray-500 font-medium">
              If this problem persists, please contact your administrator
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading...</p>
        </div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
