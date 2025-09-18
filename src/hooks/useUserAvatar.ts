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

  const loadFromStorage = useCallback(() => {
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
  }, [userId]);

  const saveToStorage = useCallback((data: AvatarData) => {
    try {
      localStorage.setItem(`${AVATAR_STORAGE_KEY}_${userId}`, JSON.stringify(data));
    } catch (err) {
      console.warn('Failed to save avatar to storage:', err);
    }
  }, [userId]);

  const fetchAvatar = useCallback(async () => {
    if (!userId) return;
    
    // First try to load from localStorage
    if (loadFromStorage()) {
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/avatars/user/${userId}`);
      
      if (response.status === 404) {
        // No avatar found - this is ok
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
      localStorage.removeItem(`${AVATAR_STORAGE_KEY}_${userId}`);
    } catch (err) {
      console.warn('Failed to clear avatar storage:', err);
    }
    fetchAvatar();
  }, [fetchAvatar, userId]);

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