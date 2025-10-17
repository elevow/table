import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useUserAvatar } from '../src/hooks/useUserAvatar';
import Avatar from '../src/components/Avatar';

const Profile: NextPage = () => {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  
  // User authentication state
  const [userId, setUserId] = useState<string>('');
  const { avatarData, refreshAvatar, updateAvatarData } = useUserAvatar(userId || 'me');

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
    console.log('Auth token in localStorage:', localStorage.getItem('auth_token')?.slice(0, 20) + '...');
    console.log('Avatar data for this userId:', avatarData);
    console.log('=== End Profile Page Debug ===');
  }, [userId, avatarData]);

  const handleAvatarUpload = useCallback(async (file: File) => {
    if (!file) return;
    
    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    
    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Get the current user ID from authentication
      // This will be handled by the server-side authentication in the upload endpoint
      const userId = 'current-user'; // Placeholder - server will use authenticated user
      
      // Get authentication token from localStorage
      const authToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      console.log('=== Avatar Upload Debug ===');
      console.log('Starting avatar upload...');
      console.log('Client-side userId (placeholder):', userId);
      console.log('Auth token exists:', !!authToken);
      console.log('Auth token preview:', authToken?.slice(0, 20) + '...');
      console.log('File size:', file.size, 'bytes');
      console.log('=== Upload Starting ===');
      
      // Create variants (different sizes) - in a real app, you might generate these on the server
      const variants = {
        small: base64, // 32x32
        medium: base64, // 64x64
        large: base64  // 128x128
      };
      
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
        body: JSON.stringify({
          originalUrl: base64,
          variants
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
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
      if (file.size > 5 * 1024 * 1024) {
        setUploadError('File size must be less than 5MB');
        return;
      }
      
      handleAvatarUpload(file);
    }
  }, [handleAvatarUpload]);

  const triggerFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head>
        <title>Profile - Table</title>
        <meta name="description" content="User profile - Table poker platform" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Header with back button */}
      <header className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Profile
            </h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Profile Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center space-x-6 mb-6">
              <div className="relative">
                <Avatar 
                  src={avatarData?.url}
                  size="lg"
                  className="ring-4 ring-indigo-500 ring-offset-4 ring-offset-white dark:ring-offset-gray-800"
                />
                {isUploading && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  Guest User
                </h2>
                <p className="text-gray-600 dark:text-gray-300 mb-3">
                  Welcome to Table!
                </p>
                
                {/* Avatar upload controls */}
                <div className="space-y-2">
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
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      isUploading 
                        ? 'bg-gray-400 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    } text-white`}
                  >
                    {isUploading ? 'Uploading...' : 'Change Avatar'}
                  </button>
                  
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Upload an image (max 5MB)
                  </p>
                </div>
                
                {/* Upload status messages */}
                {uploadError && (
                  <div className="mt-2 p-2 bg-red-100 border border-red-400 text-red-700 rounded text-xs">
                    {uploadError}
                  </div>
                )}
                {uploadSuccess && (
                  <div className="mt-2 p-2 bg-green-100 border border-green-400 text-green-700 rounded text-xs">
                    {uploadSuccess}
                  </div>
                )}
              </div>
            </div>

            {/* Profile Actions */}
            <div className="space-y-4">
              <div className="border-t dark:border-gray-700 pt-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  Quick Actions
                </h3>
                
                <div className="space-y-2">
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="w-full text-left px-4 py-3 rounded-md bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <span className="text-gray-900 dark:text-gray-100">Return to Dashboard</span>
                  </button>
                  
                  <button
                    onClick={() => router.push('/game/create')}
                    className="w-full text-left px-4 py-3 rounded-md bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <span className="text-gray-900 dark:text-gray-100">Create New Game</span>
                  </button>
                  
                  <button
                    onClick={() => router.push('/game/join')}
                    className="w-full text-left px-4 py-3 rounded-md bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <span className="text-gray-900 dark:text-gray-100">Join Game</span>
                  </button>
                </div>
              </div>

              {/* Settings Section */}
              <div className="border-t dark:border-gray-700 pt-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  Settings
                </h3>
                
                <div className="space-y-2">
                  <button 
                    onClick={() => router.push('/account-settings')}
                    className="w-full text-left px-4 py-3 rounded-md bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <span className="text-gray-900 dark:text-gray-100">Account Settings</span>
                  </button>
                  
                  <button className="w-full text-left px-4 py-3 rounded-md bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                    <span className="text-gray-900 dark:text-gray-100">Privacy Settings</span>
                  </button>
                  
                  <button className="w-full text-left px-4 py-3 rounded-md bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                    <span className="text-gray-900 dark:text-gray-100">Theme Settings</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Profile;