import React, { useState } from 'react';
import { User, LogIn, LogOut, Sun, Moon, Settings, X, Check, Sliders } from 'lucide-react';
import type { AuthUserProfile } from './LoginPage';

export type ActiveRoute =
  | { view: 'catalog' }
  | { view: 'bargain'; itemId: string }
  | { view: 'seller'; openNewModal?: boolean }
  | { view: 'login'; initialRole?: 'shopper' | 'maker'; initialMode?: 'signin' | 'signup' };

export interface WebsiteSettings {
  autoPlayChat: boolean;
  bargainStyle: 'balanced' | 'aggressive' | 'instant';
  currency: 'USD' | 'EUR' | 'GBP';
  soundEffects: boolean;
  paypalEmail: string;
}

interface NavbarProps {
  route: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
  activeLocksCount: number;
  currentUser: AuthUserProfile | null;
  onSignOut: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  settings: WebsiteSettings;
  onUpdateSettings: (next: WebsiteSettings) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  route,
  onNavigate,
  activeLocksCount,
  currentUser,
  onSignOut,
  isDark,
  onToggleTheme,
  settings,
  onUpdateSettings,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const scrollToSection = (sectionId: string) => {
    if (route.view !== 'catalog') {
      onNavigate({ view: 'catalog' });
      window.setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
    } else {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedToast(true);
    window.setTimeout(() => {
      setSavedToast(false);
      setSettingsOpen(false);
    }, 600);
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#EDF5FD]/95 backdrop-blur-md border-b border-[#CBE0F6] transition-colors">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-3 lg:gap-8">
          {/* Zone 1: Single-line Brand Wordmark + Tag Logo in PayPal Blue */}
          <button
            type="button"
            onClick={() => onNavigate({ view: 'catalog' })}
            className="inline-flex items-center gap-2 font-serif text-xl sm:text-2xl font-bold tracking-tight text-[#001C64] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0070BA]"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="text-[#003087] dark:text-[#F7F8F8] shrink-0"
            >
              <path
                fill="currentColor"
                d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
              />
              <circle cx="7.5" cy="7.5" r="1.7" fill="var(--bg-canvas)" />
            </svg>
            <span>haggle</span>
          </button>

          {/* Zone 2: Clean Single-Line Navigation Links (How It Works, Seller Studio, Settings) */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-7 text-xs sm:text-sm font-medium text-[#3B5278] dark:text-[#8A8F98]"
          >
            <button
              type="button"
              data-testid="nav-how-it-works-btn"
              onClick={() => scrollToSection('how-it-works')}
              className="hover:text-[#001C64] dark:hover:text-[#F7F8F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 font-semibold text-[#003087] dark:text-[#F7F8F8]"
            >
              How It Works
            </button>
            <button
              type="button"
              data-testid="nav-seller-studio-btn"
              onClick={() => onNavigate({ view: 'seller' })}
              className={`hover:text-[#001C64] dark:hover:text-[#F7F8F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 ${
                route.view === 'seller'
                  ? 'text-[#003087] dark:text-[#F7F8F8] font-semibold border-b-2 border-[#0070BA] dark:border-[#F7F8F8]'
                  : ''
              }`}
            >
              Seller Studio{activeLocksCount > 0 ? ` (${activeLocksCount})` : ''}
            </button>
            <button
              type="button"
              data-testid="nav-settings-btn"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 hover:text-[#001C64] dark:hover:text-[#F7F8F8] transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1"
            >
              <Settings className="w-3.5 h-3.5 text-[#0070BA] dark:text-[#8A8F98]" />
              <span>Settings</span>
            </button>
          </nav>

          {/* Zone 3: Mobile How It Works + Settings + Theme Toggle + Sign In */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => scrollToSection('how-it-works')}
              className="md:hidden px-2.5 py-1 text-xs font-semibold text-[#003087] dark:text-[#F7F8F8] hover:text-[#001C64] rounded-full border border-[#CBE0F6] dark:border-white/[0.12] bg-white/80 dark:bg-[#141518] cursor-pointer whitespace-nowrap"
            >
              How It Works
            </button>

            <button
              type="button"
              data-testid="mobile-settings-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label="Website settings"
              title="Website settings"
              className="md:hidden w-9 h-9 rounded-full border border-[#B2D1F0] dark:border-white/[0.12] bg-white dark:bg-[#141518] text-[#003087] dark:text-[#F7F8F8] hover:bg-[#E1EFFA] transition-all active:scale-95 cursor-pointer shrink-0 flex items-center justify-center shadow-2xs"
            >
              <Settings className="w-4 h-4 text-[#003087] dark:text-[#F7F8F8]" />
            </button>

            {/* Compact 36px x 36px Icon-Only Theme Toggle Button */}
            <button
              type="button"
              data-testid="theme-toggle-btn"
              onClick={onToggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-9 h-9 rounded-full border border-[#B2D1F0] dark:border-white/[0.12] bg-white dark:bg-[#141518] text-[#001C64] dark:text-[#F7F8F8] hover:bg-[#E1EFFA] dark:hover:bg-[#1C1D22] transition-all active:scale-95 cursor-pointer shrink-0 flex items-center justify-center shadow-2xs"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-[#F7F8F8]" />
              ) : (
                <Moon className="w-4 h-4 text-[#003087]" />
              )}
            </button>

            {currentUser ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-[#D9ECFF] dark:bg-white/[0.08] text-[#003087] dark:text-[#F7F8F8] rounded-lg whitespace-nowrap">
                  {currentUser.photoUrl ? (
                    <img
                      src={currentUser.photoUrl}
                      alt={currentUser.name}
                      referrerPolicy="no-referrer"
                      className="w-4 h-4 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <User className="w-3.5 h-3.5" />
                  )}
                  <span className="max-w-[120px] truncate">{currentUser.name}</span>
                </span>
                <button
                  type="button"
                  onClick={onSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="w-9 h-9 flex items-center justify-center text-xs text-[#3B5278] hover:text-[#001C64] border border-[#B2D1F0] dark:border-white/[0.12] rounded-full bg-white dark:bg-[#141518] hover:bg-[#E1EFFA] transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Single high-contrast Sign In pill on mobile (<640px); Log In button on >=640px */}
                <button
                  type="button"
                  data-testid="nav-login-btn"
                  onClick={() => onNavigate({ view: 'login', initialMode: 'signin' })}
                  className={`px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-full sm:rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1 ${
                    route.view === 'login' &&
                    (!('initialMode' in route) || route.initialMode === 'signin')
                      ? 'bg-[#003087] dark:bg-[#F7F8F8] text-white dark:text-[#08090A]'
                      : 'bg-gradient-to-r from-[#003087] to-[#0070BA] dark:bg-none dark:bg-[#141518] text-white dark:text-[#F7F8F8] sm:bg-none sm:bg-white sm:text-[#003087] hover:opacity-95 sm:hover:bg-[#E1EFFA] sm:border sm:border-[#B2D1F0] dark:border-white/[0.12]'
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5 hidden sm:inline" />
                  <span className="sm:hidden">Sign In</span>
                  <span className="hidden sm:inline">Log In</span>
                </button>

                {/* Sign Up shown on >=640px */}
                <button
                  type="button"
                  data-testid="nav-signup-btn"
                  onClick={() => onNavigate({ view: 'login', initialMode: 'signup' })}
                  className="hidden sm:inline-flex px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer bg-gradient-to-r from-[#003087] to-[#0070BA] hover:from-[#001C64] hover:to-[#003087] dark:bg-none dark:bg-[#F7F8F8] dark:hover:bg-white text-white dark:text-[#08090A] shadow-2xs"
                >
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Website Settings Modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#00143D]/60 dark:bg-black/75 backdrop-blur-xs p-4"
          data-testid="website-settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="website-settings-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0F1012] border border-[#CBE0F6] dark:border-white/[0.1] shadow-2xl overflow-hidden animate-fade-up">
            <div className="px-5 py-4 bg-gradient-to-r from-[#003087] to-[#0070BA] dark:bg-none dark:bg-[#141518] dark:border-b dark:border-white/[0.08] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#4AD7FF] dark:text-[#F7F8F8]" />
                <h2 id="website-settings-title" className="font-sans text-base font-semibold">
                  Website Settings
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className="p-1 rounded-lg hover:bg-white/15 text-white/90 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="p-5 space-y-4 text-xs sm:text-sm">
              {/* Theme Mode */}
              <div className="flex items-center justify-between gap-4 pb-3 border-b border-[#E1EFFA] dark:border-white/[0.08]">
                <div>
                  <div className="font-semibold text-[#001C64] dark:text-[#F7F8F8]">
                    Appearance Mode
                  </div>
                  <div className="text-xs text-[#3B5278] dark:text-[#8A8F98]">
                    Switch between PayPal Sky Blue and Obsidian Dark
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="px-3 py-1.5 rounded-lg border border-[#B2D1F0] dark:border-white/[0.14] bg-[#EDF5FD] dark:bg-[#16171B] text-[#003087] dark:text-[#F7F8F8] font-semibold cursor-pointer whitespace-nowrap"
                >
                  {isDark ? 'Obsidian (Dark)' : 'Sky Blue (Light)'}
                </button>
              </div>

              {/* Auto-Play Hero Chat Animation */}
              <div className="flex items-center justify-between gap-4 pb-3 border-b border-[#E1EFFA]">
                <div>
                  <div className="font-semibold text-[#001C64]">Auto-Cycle Chat Demo</div>
                  <div className="text-xs text-[#3B5278]">
                    Automatically cycle through products in the AI chat animation
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoPlayChat}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, autoPlayChat: e.target.checked })
                  }
                  className="w-4 h-4 accent-[#0070BA] cursor-pointer"
                />
              </div>

              {/* Default Bargaining Strategy */}
              <div className="space-y-1.5 pb-3 border-b border-[#E1EFFA]">
                <label className="block font-semibold text-[#001C64]">
                  Default AI Bargaining Preset
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'balanced', label: 'Balanced (-10%)' },
                      { id: 'aggressive', label: 'Bold (-18%)' },
                      { id: 'instant', label: 'Fast Lock (-8%)' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, bargainStyle: opt.id })}
                      className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        settings.bargainStyle === opt.id
                          ? 'bg-gradient-to-r from-[#003087] to-[#0070BA] text-white border-[#003087]'
                          : 'bg-[#EDF5FD] text-[#001C64] border-[#CBE0F6] hover:border-[#0070BA]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Currency & PayPal Email */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#001C64] mb-1">
                    Currency
                  </label>
                  <select
                    value={settings.currency}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        currency: e.target.value as WebsiteSettings['currency'],
                      })
                    }
                    className="w-full px-2.5 py-2 rounded-lg border border-[#B2D1F0] bg-[#EDF5FD] text-[#001C64] text-xs font-semibold outline-none"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#001C64] mb-1">
                    PayPal Express Email
                  </label>
                  <input
                    type="email"
                    value={settings.paypalEmail}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, paypalEmail: e.target.value })
                    }
                    placeholder="buyer@paypal.com"
                    className="w-full px-3 py-2 rounded-lg border border-[#B2D1F0] bg-white text-[#001C64] text-xs outline-none focus:border-[#0070BA]"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-[#CBE0F6] text-xs font-semibold text-[#3B5278] hover:text-[#001C64] cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#003087] to-[#0070BA] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {savedToast ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Saved</span>
                    </>
                  ) : (
                    <span>Save Settings</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
