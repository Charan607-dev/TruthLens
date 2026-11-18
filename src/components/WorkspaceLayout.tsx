import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileBarChart2,
  Globe2,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquarePlus,
  ScanSearch,
  Scale,
  Search,
  Settings,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

interface ModelBrief {
  trained: boolean;
  model_name?: string;
  version?: string;
}

interface RecentAlertItem {
  id: string;
  headline: string;
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  created_at: string;
}

export function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('truthlens_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [quickSearch, setQuickSearch] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [modelBrief, setModelBrief] = useState<ModelBrief | null>(null);
  const [recentItems, setRecentItems] = useState<RecentAlertItem[]>([]);

  useEffect(() => {
    apiRequest<ModelBrief>('/api/model/info')
      .then(setModelBrief)
      .catch(() => setModelBrief(null));

    apiRequest<{ recent_analyses?: RecentAlertItem[] }>('/api/dashboard/stats')
      .then((d) => setRecentItems(d.recent_analyses?.slice(0, 4) || []))
      .catch(() => {});
  }, [location.pathname]);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('truthlens_sidebar_collapsed', String(next));
      } catch {
        // ignore storage restrictions
      }
      return next;
    });
  };

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/analyze', label: 'News Analyzer', icon: ScanSearch },
    { to: '/explainability', label: 'AI Explainability', icon: Sparkles },
    { to: '/sources', label: 'Source Intelligence', icon: Globe2 },
    { to: '/verification', label: 'Fact Verification', icon: Scale },
    { to: '/history', label: 'Analysis History', icon: History },
    { to: '/reports', label: 'Reports', icon: FileBarChart2 },
    { to: '/feedback', label: 'Feedback', icon: MessageSquarePlus },
    { to: '/profile', label: 'Settings', icon: Settings },
  ];

  if (user?.role === 'admin') {
    navItems.push({ to: '/admin', label: 'Admin Console', icon: Cpu });
  }

  const currentTitle =
    navItems.find((item) => location.pathname.startsWith(item.to))?.label ||
    (location.pathname.startsWith('/history/') ? 'Verification Report' : 'Intelligence Center');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickSearch.trim();
    navigate(q ? `/history?q=${encodeURIComponent(q)}` : '/history');
  };

  const initials = (user?.full_name || user?.email || 'TL')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const renderSidebar = (isMobileDrawer = false) => {
    const isNarrow = collapsed && !isMobileDrawer;
    return (
      <div
        className={`flex flex-col h-full bg-[#101522]/90 backdrop-blur-xl border-r border-white/10 transition-[width] duration-200 ${
          isNarrow ? 'w-[76px]' : 'w-64'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-4 border-b border-white/10 flex items-center justify-between gap-2">
          <Link
            to="/"
            className="flex items-center gap-2.5 whitespace-nowrap overflow-hidden min-w-0"
            title="TruthLens AI Home"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#C6FF4D] via-[#28DFFF] to-[#9566FF] flex items-center justify-center shrink-0 shadow-[0_0_18px_rgba(40,223,255,0.28)]">
              <Shield className="w-4 h-4 text-[#080B12]" />
            </div>
            {!isNarrow && (
              <span className="font-display font-bold text-base tracking-tight text-[#F3F5F7] truncate">
                TRUTHLENS AI
              </span>
            )}
          </Link>

          {isMobileDrawer ? (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="p-1.5 text-[#929BAD] hover:text-white rounded-lg hover:bg-white/5 cursor-pointer"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleCollapse}
              className="hidden lg:inline-flex p-1.5 text-[#929BAD] hover:text-white rounded-lg hover:bg-white/5 cursor-pointer shrink-0"
              aria-label={isNarrow ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isNarrow ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isNarrow ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-2.5 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                title={isNarrow ? item.label : undefined}
                className={({ isActive }) =>
                  `group relative flex items-center ${
                    isNarrow ? 'justify-center px-2' : 'gap-3 px-3.5'
                  } py-2.5 rounded-xl text-[13px] font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-[#F3F5F7] bg-[#161D2B] border border-white/12'
                      : 'text-[#929BAD] hover:text-[#F3F5F7] hover:bg-white/[0.04] border border-transparent'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId={isMobileDrawer ? undefined : 'activeNavRail'}
                        className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-[#C6FF4D]"
                      />
                    )}
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-transform duration-150 group-hover:scale-110 ${
                        isActive ? 'text-[#C6FF4D]' : 'text-[#929BAD] group-hover:text-[#28DFFF]'
                      }`}
                    />
                    {!isNarrow && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-3 border-t border-white/10 space-y-2.5">
          {!isNarrow && (
            <div className="px-2 py-1.5 rounded-xl bg-[#080B12]/60 border border-white/8">
              <p className="text-xs font-medium text-[#F3F5F7] truncate">{user?.full_name}</p>
              <p className="text-[11px] text-[#929BAD] truncate font-mono">
                {user?.email} · {user?.role}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            title="Sign Out"
            className={`w-full flex items-center ${
              isNarrow ? 'justify-center px-2' : 'gap-2.5 px-3'
            } py-2 text-xs font-medium text-[#929BAD] hover:text-[#FF647C] hover:bg-[#FF647C]/10 rounded-xl transition-colors cursor-pointer`}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!isNarrow && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#080B12] text-[#F3F5F7] flex relative">
      {/* Subtle Ambient Background Lighting */}
      <div
        aria-hidden="true"
        className="fixed top-0 right-1/4 w-[480px] h-[360px] rounded-full bg-[#28DFFF]/[0.04] blur-[140px] pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="fixed bottom-0 left-1/3 w-[420px] h-[320px] rounded-full bg-[#9566FF]/[0.05] blur-[140px] pointer-events-none"
      />

      {/* Desktop Collapsible Sidebar */}
      <aside className="hidden lg:block shrink-0 sticky top-0 h-screen z-30">
        {renderSidebar(false)}
      </aside>

      {/* Mobile Slide-Out Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 h-full">{renderSidebar(true)}</div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col pb-16 lg:pb-0">
        {/* Custom Top Navigation Bar */}
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-8 border-b border-white/10 bg-[#080B12]/85 backdrop-blur-xl flex items-center justify-between gap-4">
          {/* Left: Mobile Trigger + Breadcrumbs */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg text-[#929BAD] hover:text-white hover:bg-white/5 cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm truncate">
              <Link
                to="/dashboard"
                className="text-[#929BAD] hover:text-[#F3F5F7] hidden sm:inline whitespace-nowrap"
              >
                TruthLens AI
              </Link>
              <span className="text-[#929BAD]/50 hidden sm:inline">/</span>
              <span className="font-display font-semibold text-[#F3F5F7] truncate">
                {currentTitle}
              </span>
            </nav>
          </div>

          {/* Center/Right: Search + Model Status + Notifications + Avatar + Primary CTA */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 shrink-0">
            <form onSubmit={handleSearchSubmit} className="hidden md:block relative">
              <Search className="w-3.5 h-3.5 text-[#929BAD] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder="Search history..."
                aria-label="Search saved analyses"
                className="w-48 lg:w-56 bg-[#101522] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#F3F5F7] placeholder:text-[#929BAD] focus:outline-none focus:border-[#28DFFF]/60 transition-colors"
              />
            </form>

            {/* Real Active Model Status Indicator */}
            {modelBrief && (
              <Link
                to={user?.role === 'admin' ? '/admin' : '/analyze'}
                className="hidden xl:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#101522] border border-white/10 hover:border-[#28DFFF]/35 text-[11px] font-mono text-[#929BAD] transition-colors whitespace-nowrap shrink-0"
                title={
                  modelBrief.trained
                    ? `Active classifier: ${modelBrief.model_name} (${modelBrief.version})`
                    : 'No active model deployed'
                }
              >
                <Cpu
                  className={`w-3.5 h-3.5 ${
                    modelBrief.trained ? 'text-[#C6FF4D]' : 'text-[#FF647C]'
                  }`}
                />
                <span className="text-[#F3F5F7]">
                  {modelBrief.trained
                    ? `${modelBrief.model_name?.replace('TF-IDF + ', '')} ${modelBrief.version}`
                    : 'Model Not Trained'}
                </span>
              </Link>
            )}

            {/* Notifications Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2 rounded-lg bg-[#101522] border border-white/10 text-[#929BAD] hover:text-[#F3F5F7] hover:border-white/20 transition-colors cursor-pointer"
                aria-label="Recent intelligence notifications"
              >
                <Bell className="w-4 h-4" />
                {recentItems.length > 0 && (
                  <span className="sr-only">{recentItems.length} recent items</span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl bg-[#161D2B] border border-white/12 shadow-2xl p-4 z-50 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-semibold text-[#F3F5F7]">
                      Intelligence Activity
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-[11px] text-[#929BAD] hover:text-white cursor-pointer"
                    >
                      Close
                    </button>
                  </div>

                  {modelBrief && !modelBrief.trained && (
                    <div className="p-2.5 rounded-lg bg-[#FF647C]/10 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
                      No active trained model is deployed. Train and activate a model in Admin Console.
                    </div>
                  )}

                  {recentItems.length === 0 ? (
                    <p className="text-xs text-[#929BAD] py-2">
                      No recent analyses recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {recentItems.map((r) => (
                        <Link
                          key={r.id}
                          to={`/history/${r.id}`}
                          onClick={() => setNotifOpen(false)}
                          className="block p-2.5 rounded-lg bg-[#101522] hover:bg-[#080B12] border border-white/8 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono mb-0.5">
                            <span
                              className={
                                r.prediction === 'REAL'
                                  ? 'text-[#C6FF4D]'
                                  : r.prediction === 'FAKE'
                                    ? 'text-[#FF647C]'
                                    : 'text-[#C4A8FF]'
                              }
                            >
                              {r.prediction}
                            </span>
                            <span className="text-[#929BAD]">
                              {new Date(r.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-[#F3F5F7] line-clamp-1">{r.headline}</p>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* User Avatar */}
            <Link
              to="/profile"
              title={`${user?.full_name} (${user?.role})`}
              className="w-8 h-8 rounded-lg bg-[#161D2B] border border-white/15 hover:border-[#28DFFF]/50 flex items-center justify-center text-xs font-mono font-semibold text-[#28DFFF] shrink-0 transition-colors"
            >
              {initials}
            </Link>

            <Link
              to="/analyze"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ScanSearch className="w-3.5 h-3.5" />
              <span>Analyse News</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto relative z-10">
          {children}
        </main>
      </div>

      {/* Compact Mobile Bottom Navigation (height 56px, well under 15% cap) */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden h-14 bg-[#101522]/95 backdrop-blur-xl border-t border-white/10 grid grid-cols-5"
      >
        {[
          { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
          { to: '/analyze', label: 'Analyze', icon: ScanSearch },
          { to: '/explainability', label: 'Explain', icon: Sparkles },
          { to: '/history', label: 'History', icon: History },
          { to: '/reports', label: 'Reports', icon: FileBarChart2 },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <NavLink
              key={m.to}
              to={m.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                  isActive ? 'text-[#C6FF4D]' : 'text-[#929BAD]'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span>{m.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
