import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useRef, useCallback, useEffect } from 'react';
import ProfileDisplaySettings from '../src/components/ProfileDisplaySettings';
import { useUserAvatar } from '../src/hooks/useUserAvatar';
import Avatar from '../src/components/Avatar';
import AppShell, { useStoredUsername } from '../src/components/AppShell';
import { useTheme } from '../src/contexts/ThemeContext';
import { MAX_AVATAR_FILE_BYTES, shrinkAvatar, uploadErrorMessage } from '../src/utils/avatar-image';

const Profile: NextPage = () => {
  const router = useRouter();
  const username = useStoredUsername();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();
  
  // User authentication state
  const [userId, setUserId] = useState<string>('');
  const { avatarData, refreshAvatar, updateAvatarData } = useUserAvatar(userId || 'me');
  // Shown until permissions load (or if they can't), since the API refuses room.create anyway
  const [canCreateRoom, setCanCreateRoom] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    fetch('/api/auth/check-admin', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data) setCanCreateRoom((data.permissions || []).includes('room.create'));
      })
      .catch(() => {});
  }, []);

  // Get authenticated user ID on component mount
  useEffect(() => {
  const getAuthenticatedUserId = async () => {
      try {
        const authToken = localStorage.getItem('auth_token');
        if (authToken) {
          const response = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log('Profile - Using authenticated user ID:', data.userId);
            setUserId(data.userId);
          } else {
            console.log('Profile - Authentication failed; avatar endpoint will resolve "me" only when authenticated');
          }
        } else {
          console.log('Profile - No auth token; avatar endpoint will resolve "me" only when authenticated');
        }
      } catch (error) {
        console.error('Profile - Error getting authenticated user ID:', error);
      }
    };
    
    getAuthenticatedUserId();
  }, []);

  // Debug logging for userId tracking
  useEffect(() => {
    console.log('=== Profile Page Avatar Debug ===');
    console.log('Profile page userId:', userId);
    console.log('Avatar data for this userId:', avatarData);
    console.log('=== End Profile Page Debug ===');
  }, [userId, avatarData]);

  const handleAvatarUpload = useCallback(async (file: File) => {
    if (!file) return;
    
    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    
    try {
      // Shrink it first: the upload limit is far smaller than a phone photo
      const image = await shrinkAvatar(file);
      
      // Get the current user ID from authentication
      // This will be handled by the server-side authentication in the upload endpoint
      const userId = 'current-user'; // Placeholder - server will use authenticated user
      
      // Get authentication token from localStorage
      const authToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      console.log('=== Avatar Upload Debug ===');
      console.log('Starting avatar upload...');
      console.log('Client-side userId (placeholder):', userId);
      console.log('Auth token exists:', !!authToken);
      console.log('File size:', file.size, 'bytes');
      console.log('=== Upload Starting ===');
      
      if (!authToken) {
        throw new Error('Please log in to upload an avatar');
      }
      
      // Upload the avatar using the real endpoint
      const response = await fetch('/api/avatars/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ originalUrl: image }),
      });
      
      if (!response.ok) {
        throw new Error(await uploadErrorMessage(response));
      }
      
      const result = await response.json();
      
      console.log('=== Avatar Upload Success ===');
      console.log('Upload response:', result);
      console.log('Avatar ID returned:', result.id);
      console.log('Avatar URL returned:', result.url);
      console.log('Server processed for authenticated user (check server logs)');
      console.log('=== Upload Complete ===');
      
      setUploadSuccess('Avatar uploaded successfully!');
      
      // Update the avatar data in the hook
      updateAvatarData({
        id: result.id,
        url: result.url,
        thumbnails: result.thumbnails,
        status: result.status
      });
      
    } catch (error) {
      console.error('Avatar upload error:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [updateAvatarData]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setUploadError('Please select an image file');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > MAX_AVATAR_FILE_BYTES) {
        setUploadError('File size must be less than 5MB');
        return;
      }
      
      handleAvatarUpload(file);
    }
  }, [handleAvatarUpload]);

  const triggerFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const Row = ({ label, onClick, right }: { label: string; onClick?: () => void; right?: React.ReactNode }) => (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/3"
    >
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
        {right}
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.2 14.8a1 1 0 010-1.4L10.6 10 7.2 6.6a1 1 0 111.4-1.4l4.1 4.1a1 1 0 010 1.4l-4.1 4.1a1 1 0 01-1.4 0z" clipRule="evenodd" /></svg>
      </span>
    </button>
  );

  return (
    <AppShell>
      <Head>
        <title>Profile - Table</title>
        <meta name="description" content="User profile - Table poker platform" />
      </Head>

      <main className="page-narrow space-y-6">
        {/* Identity */}
        <section className="surface relative overflow-hidden p-6 sm:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-emerald-500/10 to-transparent" />
          <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <div className="relative">
              <Avatar
                src={avatarData?.url}
                size="lg"
                className="h-20! w-20! ring-4 ring-white dark:ring-gray-800 shadow-card"
              />
              {isUploading && (
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
                {username || 'Guest'}
              </h1>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {username ? 'Your public name at every table.' : 'Sign in to keep your name, stats and avatar.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isUploading}
                />
                <button
                  onClick={triggerFileSelect}
                  disabled={isUploading}
                  className="btn btn-secondary btn-sm"
                >
                  {isUploading ? 'Uploading...' : 'Change avatar'}
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">JPG, PNG or GIF, up to 5MB</span>
              </div>
              {uploadError && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                  {uploadError}
                </div>
              )}
              {uploadSuccess && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  {uploadSuccess}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Quick actions */}
        <section>
          <h2 className="eyebrow mb-2 px-1">Quick actions</h2>
          <div className="surface divide-y divide-gray-100 overflow-hidden dark:divide-white/5">
            <Row label="Back to the lobby" onClick={() => router.push('/dashboard')} />
            {canCreateRoom && <Row label="Create a table" onClick={() => router.push('/game/create')} />}
          </div>
        </section>

        <ProfileDisplaySettings />

        {/* Settings */}
        <section>
          <h2 className="eyebrow mb-2 px-1">Settings</h2>
          <div className="surface divide-y divide-gray-100 overflow-hidden dark:divide-white/5">
            <Row label="Account settings" onClick={() => router.push('/account-settings')} />
            <Row
              label="Theme"
              onClick={toggleTheme}
              right={<span className="text-xs">{theme === 'dark' ? 'Dark' : 'Light'}</span>}
            />
          </div>
        </section>
      </main>
    </AppShell>
  );
};

export default Profile;
