import { useEffect, useRef, useState } from 'react';
import { BookMarked, Github, LogOut, Radio, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fetchOnlineCount, sendHeartbeat } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { navigate, useAppLocation } from '@/lib/router';
import { getUserId } from '@/lib/storage';

const navDockButtonClass =
  'h-9 rounded-full border border-transparent bg-transparent px-3 text-sm font-semibold text-[#425166] shadow-none transition hover:border-white/80 hover:bg-white/78 hover:text-[#172033] hover:shadow-[0_10px_28px_rgba(15,23,42,0.08)]';
const navDockActiveButtonClass =
  'h-9 rounded-full border border-white/80 bg-white/82 px-3 text-sm font-semibold text-[#172033] shadow-[0_10px_28px_rgba(15,23,42,0.08)] transition hover:bg-white hover:text-[#172033]';

export function SiteNavbar() {
  const location = useAppLocation();
  const { user, logout } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [onlineCount, setOnlineCount] = useState(0);
  const lastScrollYRef = useRef(0);
  const isPaperPage = location.pathname.startsWith('/papers/');

  useEffect(() => {
    const handleScroll = () => {
      const current = window.scrollY;
      if (current > 100) {
        setIsScrolled(true);
        if (isPaperPage) {
          setIsVisible(false);
        } else {
          setIsVisible(current < lastScrollYRef.current);
        }
      } else {
        setIsScrolled(false);
        setIsVisible(true);
      }
      lastScrollYRef.current = current;
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isPaperPage]);

  useEffect(() => {
    let mounted = true;

    const syncPresence = async () => {
      try {
        const userId = getUserId();
        await sendHeartbeat(userId);
        const count = await fetchOnlineCount();
        if (mounted) {
          setOnlineCount(count);
        }
      } catch {
        if (mounted) {
          setOnlineCount(0);
        }
      }
    };

    void syncPresence();
    const interval = window.setInterval(() => {
      void syncPresence();
    }, 15000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [user?.id]);

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-50 transition-all duration-500 ${
        isScrolled
          ? isVisible
            ? 'translate-y-0 border-b border-white/60 bg-white/75 shadow-sm backdrop-blur-xl'
            : '-translate-y-full'
          : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-[104rem] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="group flex items-center gap-3"
        >
          <img
            src="/images/logo.svg"
            alt="Paper Insight logo"
            className="h-11 w-11 rounded-2xl object-contain shadow-sm transition-transform duration-300 group-hover:scale-[1.04]"
          />
          <div className="hidden text-left sm:block">
            <div className="font-semibold tracking-tight text-[#1b2333]">Paper Insight</div>
            <div className="text-xs text-[#728095]">AI-driven paper analysis</div>
          </div>
        </button>

        <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/70 bg-white/48 p-1 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="hidden h-9 shrink-0 items-center gap-2 rounded-full border border-transparent px-3 text-sm font-medium text-[#526174] md:flex">
            <Radio className="h-4 w-4 text-[#16a34a]" />
            <span>{onlineCount} 人在线</span>
          </div>
          {user ? (
            <>
              <Button
                variant="outline"
                className={location.pathname === '/me' ? navDockActiveButtonClass : navDockButtonClass}
                onClick={() => navigate('/me')}
              >
                <BookMarked className="mr-2 h-4 w-4 text-[#2563eb]" />
                <span className="hidden sm:inline">我的论文</span>
              </Button>
              {user.role === 'admin' ? (
                <Button
                  variant="outline"
                  className={location.pathname === '/admin' ? navDockActiveButtonClass : navDockButtonClass}
                  onClick={() => navigate('/admin')}
                >
                  <Shield className="mr-2 h-4 w-4 text-[#c2410c]" />
                  <span className="hidden sm:inline">后台</span>
                </Button>
              ) : null}
              <div className="hidden h-9 max-w-[14rem] items-center truncate rounded-full border border-white/70 bg-white/55 px-3 text-sm text-[#586578] lg:flex">
                {user.email}
              </div>
              <Button
                variant="outline"
                className={navDockButtonClass}
                onClick={() => void logout()}
              >
                <LogOut className="mr-2 h-4 w-4 text-[#64748b]" />
                <span className="hidden sm:inline">退出</span>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className={navDockButtonClass}
                onClick={() => navigate('/login')}
              >
                登录
              </Button>
              <Button
                className="h-9 rounded-full bg-gradient-to-r from-[#ff9900] to-[#ff7a00] px-4 text-sm font-semibold text-white shadow-[0_12px_34px_rgba(255,122,0,0.28)] transition hover:from-[#ff8a00] hover:to-[#ff6f00]"
                onClick={() => navigate('/register')}
              >
                注册
              </Button>
            </>
          )}
          <Button
            variant="outline"
            className={`${navDockButtonClass} hidden sm:inline-flex`}
            onClick={() => window.open('https://www.xiaohongshu.com/user/profile/63c2055e000000002502c58c', '_blank', 'noopener,noreferrer')}
          >
            小红书
          </Button>
          <Button
            variant="outline"
            className={`${navDockButtonClass} hidden sm:inline-flex`}
            onClick={() => window.open('https://github.com/KMnO4-zx/paper_online', '_blank', 'noopener,noreferrer')}
          >
            <Github className="mr-2 h-4 w-4 text-[#334155]" />
            GitHub
          </Button>
        </div>
      </div>
    </header>
  );
}
