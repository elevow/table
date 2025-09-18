import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useRef, useCallback } from 'react';
import { useUserAvatar } from '../src/hooks/useUserAvatar';
import Avatar from '../src/components/Avatar';

const Profile: NextPage = () => {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  
  // For now, using a mock userId - in a real app this would come from authentication
  const userId = 'user-123';
  const { avatarData, refreshAvatar, updateAvatarData } = useUserAvatar(userId);

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
      
      // For now, we'll use a mock userId - in a real app this would come from authentication
      const userId = '550e8400-e29b-41d4-a716-446655440000'; // Valid UUID format for testing
      
      // Create variants (different sizes) - in a real app, you might generate these on the server
      const variants = {
        small: base64, // 32x32
        medium: base64, // 64x64
        large: base64  // 128x128
      };
      
      // Upload the avatar using JSON (using mock for now)
      const response = await fetch('/api/avatars/upload-mock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          originalUrl: base64,
          variants
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }
      
      const result = await response.json();
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
                  <button className="w-full text-left px-4 py-3 rounded-md bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
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