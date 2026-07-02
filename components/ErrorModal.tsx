'use client';

import React from 'react';
import { createPortal } from 'react-dom';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  details?: string | string[];
  showCloseOnBackdrop?: boolean;
}

export default function ErrorModal({
  isOpen,
  onClose,
  title,
  message,
  details,
  showCloseOnBackdrop = true,
}: ErrorModalProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!isOpen || !mounted) return null;

  // Format details for display
  const formatDetails = () => {
    if (!details) return null;

    if (typeof details === 'string') {
      return <p className="text-sm text-slate-400 font-mono mt-2">{details}</p>;
    }

    if (Array.isArray(details)) {
      // For short lists, display inline
      if (details.length <= 5) {
        return (
          <p className="text-sm text-slate-400 font-mono mt-2">
            {details.join(', ')}
          </p>
        );
      }

      // For longer lists, display in scrollable container
      return (
        <div className="mt-3 bg-slate-900/50 rounded-lg border border-slate-700/50 max-h-48 overflow-y-auto p-3">
          <div className="space-y-1">
            {details.map((detail, idx) => (
              <p key={idx} className="text-sm text-slate-300 font-mono font-semibold">
                {detail}
              </p>
            ))}
          </div>
        </div>
      );
    }

    return null;
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div
          className="fixed inset-0 transition-opacity bg-black/50 backdrop-blur-sm"
          onClick={showCloseOnBackdrop ? onClose : undefined}
        />

        {/* Modal */}
        <div className="inline-block align-bottom bg-slate-800/90 border border-red-500/50 rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full backdrop-blur-sm relative z-[10000]">
          <div className="bg-slate-800/60 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex items-start">
              {/* Error Icon */}
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-red-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>

              {/* Content */}
              <div className="ml-4 flex-1">
                <h3 className="text-xl font-bold text-red-400 mb-2">
                  {title}
                </h3>
                <p className="text-sm text-slate-300 mb-2">
                  {message}
                </p>
                {formatDetails()}
              </div>
            </div>
          </div>

          {/* Footer with OK Button */}
          <div className="bg-slate-800/40 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Render modal using portal to document body to ensure it overlays the entire screen
  return createPortal(modalContent, document.body);
}
