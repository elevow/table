import { useState, useEffect, useCallback } from 'react';

interface AvatarData {
  id: string;
  url: string;
  thumbnails: Record<string, string>;
  status: string;
}

const AVATAR_STORAGE_KEY = 'user_avatar_data';

export function useUserAvatar(userId: string) {
  const [avatarData, setAvatarData] = useState<AvatarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAlias = userId === 'me' || userId === 'current-user';

  const loadFromStorage = useCallback(() => {
    if (isAlias) return false; // don't cache alias-based requests
    try {
      const stored = localStorage.getItem(`${AVATAR_STORAGE_KEY}_${userId}`);
      if (stored) {
        const data = JSON.parse(stored);
        setAvatarData(data);
        return true;
      }
    } catch (err) {
      console.warn('Failed to load avatar from storage:', err);
    }
    return false;
  }, [userId, isAlias]);

  const saveToStorage = useCallback((data: AvatarData) => {
    if (isAlias) return; // don't cache alias-based responses
    try {
      localStorage.setItem(`${AVATAR_STORAGE_KEY}_${userId}`, JSON.stringify(data));
    } catch (err) {
      console.warn('Failed to save avatar to storage:', err);
    }
  }, [userId, isAlias]);

  const fetchAvatar = useCallback(async () => {
    if (!userId) return;
    
    // First try to load from localStorage
    if (loadFromStorage()) {
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Include auth token if available, especially for alias-based requests like 'me'
      const authToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const headers: HeadersInit = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(`/api/avatars/user/${userId}`, { headers });
      
      if (response.status === 404) {
        // No avatar found - this is ok
        setAvatarData(null);
        return;
      }
      
      if (response.status === 401) {
        // Not authenticated - this is ok, just don't show an avatar
        setAvatarData(null);
        return;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch avatar: ${response.statusText}`);
      }
      
      const data = await response.json();
      setAvatarData(data);
      saveToStorage(data);
    } catch (err) {
      console.error('Error fetching avatar:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch avatar');
    } finally {
      setLoading(false);
    }
  }, [userId, loadFromStorage, saveToStorage]);

  const updateAvatarData = useCallback((data: AvatarData) => {
    setAvatarData(data);
    saveToStorage(data);
  }, [saveToStorage]);

  const refreshAvatar = useCallback(() => {
    // Clear storage and fetch fresh
    try {
      if (!isAlias) {
        localStorage.removeItem(`${AVATAR_STORAGE_KEY}_${userId}`);
      }
    } catch (err) {
      console.warn('Failed to clear avatar storage:', err);
    }
    fetchAvatar();
  }, [fetchAvatar, userId, isAlias]);

  useEffect(() => {
    fetchAvatar();
  }, [fetchAvatar]);

  return {
    avatarData,
    loading,
    error,
    refreshAvatar,
    updateAvatarData
  };
}