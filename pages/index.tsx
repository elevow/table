import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { BrandMark } from '../src/components/AppShell';

const Home: NextPage = () => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where to go after signing in: a page that sent the visitor here (an invite link), else the dashboard.
  // Only paths on this site, so a crafted link can't send someone elsewhere.
  const next = typeof router.query.next === 'string' ? router.query.next : '';
  const afterSignIn = next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const body = isLogin 
        ? { email, password }
        : { email, username, password };
        
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // Handle API error responses (4xx, 5xx)
        setError(data.error || `HTTP error! status: ${response.status}`);
        return;
      }
      
      if (data.success) {
        console.log('Login successful, data:', data);
        
        // Store token in localStorage for session management
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        console.log('Auth data stored in localStorage');
        
        // Try router.push first, with fallback to window.location
        console.log('Attempting navigation to dashboard...');
        try {
          const navigationPromise = router.push(afterSignIn);
          console.log('Router.push called, awaiting...');
          
          // Set a timeout for fallback navigation
          const timeoutId = setTimeout(() => {
            console.log('Router navigation timeout, using window.location.href');
            window.location.href = afterSignIn;
          }, 2000);
          
          await navigationPromise;
          console.log('Router navigation successful');
          clearTimeout(timeoutId);
          
        } catch (routerError) {
          console.error('Router navigation failed:', routerError);
          console.log('Using window.location.href fallback');
          window.location.href = afterSignIn;
        }
      } else {
        console.log('Login failed:', data);
        setError(data.error || 'Authentication failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestAccess = () => {
    router.push('/dashboard');
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden px-4 py-12">
      {/* A soft felt glow behind the card */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 50% 45% at 50% 50%, rgba(16,185,129,0.10), transparent 70%)' }} />
      </div>
      <Head>
        <title>{`${isLogin ? 'Login' : 'Sign Up'} - Table`}</title>
        <meta name="description" content="Login to Table - Online poker platform" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="relative w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center mb-8">
          <BrandMark className="h-12 w-12 rounded-xl" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            {isLogin ? 'Sign in to pull up a chair at Table.' : 'Join Table and start a game with friends.'}
          </p>
        </div>
        <div className="surface p-6 sm:p-8">

          {/* Login/Signup Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="label">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input h-11"
                placeholder="Enter your email"
              />
            </div>

            {!isLogin && (
              <div>
                <label htmlFor="username" className="label">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input h-11"
                  placeholder="Choose a username"
                />
              </div>
            )}

            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input h-11"
                placeholder="Enter your password"
              />
            </div>

            {!isLogin && (
              <div>
                <label htmlFor="confirmPassword" className="label">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="input h-11"
                  placeholder="Confirm your password"
                />
              </div>
            )}

            {isLogin && (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="checkbox"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-600 dark:text-gray-400">
                    Remember me
                  </label>
                </div>
                <Link href="/forgot-password" className="link text-sm">
                  Forgot password?
                </Link>
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full h-11"
            >
              {loading ? (
                <div className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </div>
              ) : (
                isLogin ? 'Sign in' : 'Create account'
              )}
            </button>
          </form>

          {/* Guest access */}
          <div className="mt-6">
            <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
              <div className="h-px flex-1 bg-gray-200 dark:bg-white/8" />
              or
              <div className="h-px flex-1 bg-gray-200 dark:bg-white/8" />
            </div>
            <button
              type="button"
              onClick={handleGuestAccess}
              className="btn btn-secondary mt-6 w-full h-11 font-medium! dark:text-gray-300!"
            >
              Continue as guest
            </button>
          </div>
        </div>

          {/* Toggle between login/signup */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError(null); // Clear error when switching
                }}
                className="link"
              >
                {isLogin ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>
      </main>
    </div>
  );
};

export default Home;
