import { type SVGProps, useEffect, useRef, useState } from 'react';
import { BookMarked, Github, LogOut, MessageSquare, Radio, ScrollText, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fetchOnlineCount, sendHeartbeat } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { navigate, useAppLocation } from '@/lib/router';
import { getUserId } from '@/lib/storage';

const navDockButtonClass =
  'h-9 rounded-full border border-transparent bg-transparent px-2.5 text-[13px] font-semibold text-[#425166] shadow-none transition hover:border-white/80 hover:bg-white/78 hover:text-[#172033] hover:shadow-[0_10px_28px_rgba(15,23,42,0.08)]';
const navDockActiveButtonClass =
  'h-9 rounded-full border border-white/80 bg-white/82 px-2.5 text-[13px] font-semibold text-[#172033] shadow-[0_10px_28px_rgba(15,23,42,0.08)] transition hover:bg-white hover:text-[#172033]';
const onlinePillClass =
  'h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/80 bg-white/68 px-3 text-[13px] font-medium text-[#526174] shadow-[0_12px_34px_rgba(15,23,42,0.08)] backdrop-blur-xl';
const feedbackFormUrl = 'https://rcnpx636fedp.feishu.cn/share/base/form/shrcn8zCkNPabSlIaOzTk139Rxh';

function XiaohongshuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M0 0m256 0l512 0q256 0 256 256l0 512q0 256-256 256l-512 0q-256 0-256-256l0-512q0-256 256-256Z"
        fill="#FA2C19"
      />
      <path
        d="M445.824 766.293333c4.181333-9.130667 7.68-17.066667 11.477333-24.789333a512 512 0 0 0 23.253334-49.237333 29.141333 29.141333 0 0 1 34.773333-21.717334c21.973333 1.578667 44.032 0.426667 66.986667 0.426667V384.853333c-15.445333 0-30.677333-0.554667-45.781334 0-10.538667 0.554667-14.250667-2.901333-13.909333-14.165333 0.725333-27.093333 0-54.272 0-82.602667h214.229333v65.706667c0 30.890667 0 30.890667-29.952 30.890667h-30.122666v285.952h65.024c26.197333 0 26.197333 0 26.197333 27.52v57.642666c0 7.978667-1.962667 12.032-10.624 12.032-101.674667-0.170667-203.392-0.298667-305.066667-0.213333a37.717333 37.717333 0 0 1-6.485333-1.365333"
        fill="#FFFFFF"
      />
      <path
        d="M486.357333 559.146667c-13.397333 27.605333-25.173333 52.266667-37.546666 76.501333a11.605333 11.605333 0 0 1-8.96 4.522667c-29.781333 0-59.733333 1.152-89.429334-1.066667-29.738667-2.218667-41.642667-21.333333-29.781333-50.517333 13.482667-33.664 29.738667-66.218667 44.8-99.2l3.413333-8.832c-12.032 0-22.570667 0.298667-33.109333 0-8.576 0.128-17.152-0.682667-25.514667-2.346667a30.037333 30.037333 0 0 1-25.728-33.536 30.72 30.72 0 0 1 2.901334-10.112c18.048-43.349333 38.272-85.845333 57.770666-128.554667 6.357333-13.994667 13.013333-27.776 20.181334-41.386666 1.834667-3.541333 6.101333-8.064 9.386666-8.192 27.861333-0.682667 55.808-0.341333 86.186667-0.341334-2.645333 6.784-4.138667 11.392-6.144 15.701334-17.066667 35.712-34.176 71.381333-51.370667 106.965333-3.456 7.210667-7.68 14.72 5.290667 20.224 3.413333-18.56 17.408-15.189333 29.610667-15.189333h70.4c-2.944 7.04-4.864 11.946667-6.997334 16.597333-21.76 45.44-43.861333 90.538667-65.28 135.936-8.789333 18.474667-5.845333 22.997333 14.634667 23.168 10.538667-0.298667 21.205333-0.341333 35.285333-0.341333m-38.314666 111.872c-16.512 33.109333-31.274667 62.890667-46.378667 92.501333a10.24 10.24 0 0 1-7.68 4.266667c-40.490667-0.426667-81.066667-1.194667-121.685333-2.261334a79.317333 79.317333 0 0 1-16.298667-4.266666l22.698667-45.909334c7.381333-15.189333 14.592-30.293333 22.570666-44.714666a13.653333 13.653333 0 0 1 9.728-6.4c37.205333 1.834667 74.410667 4.437333 111.658667 6.698666 7.424 0.384 14.506667 0.085333 25.386667 0.085334"
        fill="#FFFFFF"
      />
    </svg>
  );
}

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
      <div className="mx-auto grid max-w-[104rem] grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-4 py-4 sm:px-6 lg:px-8 2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="group flex items-center gap-3 justify-self-start"
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

        <div className={`${onlinePillClass} hidden justify-self-center 2xl:flex`}>
          <Radio className="h-4 w-4 text-[#16a34a]" />
          <span>{onlineCount} 人在线</span>
        </div>

        <div className="flex min-w-0 items-center gap-1 justify-self-end rounded-full border border-white/70 bg-white/48 p-1 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className={`${onlinePillClass} hidden border-transparent bg-transparent px-2.5 shadow-none backdrop-blur-none md:flex 2xl:hidden`}>
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
                <BookMarked className="mr-1.5 h-4 w-4 text-[#2563eb]" />
                <span className="hidden sm:inline">我的论文</span>
              </Button>
              {user.role === 'admin' ? (
                <Button
                  variant="outline"
                  className={location.pathname === '/admin' ? navDockActiveButtonClass : navDockButtonClass}
                  onClick={() => navigate('/admin')}
                >
                  <Shield className="mr-1.5 h-4 w-4 text-[#c2410c]" />
                  <span className="hidden sm:inline">后台管理</span>
                </Button>
              ) : null}
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
                className="h-9 rounded-full bg-gradient-to-r from-[#ff9900] to-[#ff7a00] px-3.5 text-[13px] font-semibold text-white shadow-[0_12px_34px_rgba(255,122,0,0.28)] transition hover:from-[#ff8a00] hover:to-[#ff6f00]"
                onClick={() => navigate('/register')}
              >
                注册
              </Button>
            </>
          )}
          <Button
            variant="outline"
            className={location.pathname === '/changelog' ? navDockActiveButtonClass : navDockButtonClass}
            onClick={() => navigate('/changelog')}
          >
            <ScrollText className="mr-1.5 h-4 w-4 text-[#475569]" />
            <span className="hidden sm:inline">更新日志</span>
          </Button>
          <Button
            variant="outline"
            className={`${navDockButtonClass} hidden sm:inline-flex`}
            onClick={() => window.open('https://www.xiaohongshu.com/user/profile/63c2055e000000002502c58c', '_blank', 'noopener,noreferrer')}
          >
            <XiaohongshuIcon className="mr-1.5 h-4 w-4" />
            小红书
          </Button>
          <Button
            variant="outline"
            className={`${navDockButtonClass} hidden sm:inline-flex`}
            onClick={() => window.open('https://github.com/KMnO4-zx/paper_online', '_blank', 'noopener,noreferrer')}
          >
            <Github className="mr-1.5 h-4 w-4 text-[#334155]" />
            GitHub
          </Button>
          <Button
            variant="outline"
            className={`${navDockButtonClass} hidden sm:inline-flex`}
            onClick={() => window.open(feedbackFormUrl, '_blank', 'noopener,noreferrer')}
          >
            <MessageSquare className="mr-1.5 h-4 w-4 text-[#0891b2]" />
            反馈
          </Button>
          {user ? (
            <Button
              variant="outline"
              className={navDockButtonClass}
              onClick={() => void logout()}
            >
              <LogOut className="mr-1.5 h-4 w-4 text-[#64748b]" />
              <span className="hidden sm:inline">退出</span>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
