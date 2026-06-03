import { SiteNavbar } from '@/components/site-navbar';
import { HomePage } from '@/pages/home-page';
import { ConferencePage } from '@/pages/conference-page';
import { HfDailyPage } from '@/pages/hf-daily-page';
import { PaperPage } from '@/pages/paper-page';
import { SearchPage } from '@/pages/search-page';
import { AdminPage } from '@/pages/admin-page';
import { AuthPage } from '@/pages/auth-page';
import { ProfilePage } from '@/pages/profile-page';
import { useAppLocation } from '@/lib/router';

function App() {
  const location = useAppLocation();

  const pathname = location.pathname;

  let content = <HomePage />;
  if (pathname === '/search') {
    content = <SearchPage />;
  } else if (pathname === '/hf-daily') {
    content = <HfDailyPage />;
  } else if (pathname === '/login') {
    content = <AuthPage mode="login" />;
  } else if (pathname === '/register') {
    content = <AuthPage mode="register" />;
  } else if (pathname === '/admin') {
    content = <AdminPage />;
  } else if (pathname === '/me') {
    content = <ProfilePage />;
  } else if (pathname.startsWith('/conference/')) {
    const venue = pathname.replace('/conference/', '').split('/')[0];
    content = <ConferencePage venue={venue} />;
  } else if (pathname.startsWith('/papers/')) {
    const paperId = pathname.replace('/papers/', '').split('/')[0];
    content = <PaperPage paperId={paperId} />;
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-[#172033]">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(255,214,107,0.35),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(125,211,252,0.22),_transparent_28%),linear-gradient(180deg,_#f7f9fc_0%,_#eef2f8_100%)]" />
      <SiteNavbar />
      <main className="px-4 pb-16 pt-40 sm:px-6 sm:pt-28 lg:px-8">{content}</main>
    </div>
  );
}

export default App;
