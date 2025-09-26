import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';

const AccountSettings: NextPage = () => {
  const router = useRouter();
  const [playerName, setPlayerName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Load current player name from localStorage on component mount
  useEffect(() => {
    const savedPlayerName = localStorage.getItem('playerName');
    if (savedPlayerName) {
      setPlayerName(savedPlayerName);
    }
  }, []);

  const handleSavePlayerName = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!playerName.trim()) {
      setMessage({ type: 'error', text: 'Player name cannot be empty' });
      return;
    }
    
    if (playerName.trim().length < 2) {
      setMessage({ type: 'error', text: 'Player name must be at least 2 characters long' });
      return;
    }
    
    if (playerName.trim().length > 20) {
      setMessage({ type: 'error', text: 'Player name must be less than 20 characters long' });
      return;
    }
    
    setIsLoading(true);
    setMessage(null);
    
    try {
      // Save to localStorage (in a real app, you'd save to a database)
      localStorage.setItem('playerName', playerName.trim());
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setMessage({ type: 'success', text: 'Player name saved successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save player name. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <>
      <Head>
        <title>Account Settings - Poker Table</title>
        <meta name="description" content="Manage your account settings" />
      </Head>

      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 py-8">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={handleBack}
              className="inline-flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-4"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Account Settings
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Manage your player profile and preferences
            </p>
          </div>

          {/* Settings Form */}
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Player Information
              </h2>
            </div>
            
            <form onSubmit={handleSavePlayerName} className="px-6 py-6">
              {/* Player Name Field */}
              <div className="mb-6">
                <label htmlFor="playerName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Player Name
                </label>
                <input
                  type="text"
                  id="playerName"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm 
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                             placeholder-gray-400 dark:placeholder-gray-500"
                  placeholder="Enter your player name"
                  maxLength={20}
                  disabled={isLoading}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This name will be displayed at the poker table and in game rooms.
                </p>
              </div>

              {/* Message Display */}
              {message && (
                <div className={`mb-4 p-3 rounded-md ${
                  message.type === 'success' 
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                }`}>
                  <div className="flex items-center">
                    {message.type === 'success' ? (
                      <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className="text-sm">{message.text}</span>
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
                    isLoading
                      ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-md'
                  }`}
                >
                  {isLoading ? (
                    <div className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </div>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Additional Settings Sections (for future expansion) */}
          <div className="mt-8 bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Game Preferences
              </h2>
            </div>
            
            <div className="px-6 py-6">
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Additional game settings and preferences will be available here in future updates.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AccountSettings;