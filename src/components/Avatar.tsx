import React from 'react';

interface AvatarProps {
  size?: 'sm' | 'md' | 'lg';
  src?: string | null;
  alt?: string;
  fallback?: string;
  className?: string;
  onClick?: () => void;
}

const Avatar: React.FC<AvatarProps> = ({
  size = 'md',
  src,
  alt = 'User avatar',
  fallback,
  className = '',
  onClick
}) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-12 h-12 text-lg'
  };

  const baseClasses = `
    inline-flex items-center justify-center 
    rounded-full bg-gray-200 dark:bg-gray-700 
    text-gray-600 dark:text-gray-300 
    font-medium overflow-hidden
    ${onClick ? 'cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600' : ''}
    ${sizeClasses[size]}
    ${className}
  `.trim().replace(/\s+/g, ' ');

  // If we have an image source, try to display it
  if (src) {
    return (
      <div className={baseClasses} onClick={onClick}>
        <img 
          src={src} 
          alt={alt} 
          className="w-full h-full object-cover rounded-full"
          onError={(e) => {
            // If image fails to load, hide it and show fallback
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        {/* Fallback content in case image fails */}
        <div className="w-full h-full flex items-center justify-center">
          {fallback || (
            <UserIcon className="w-1/2 h-1/2" />
          )}
        </div>
      </div>
    );
  }

  // Default avatar with icon or initials
  return (
    <div className={baseClasses} onClick={onClick}>
      {fallback || (
        <UserIcon className="w-1/2 h-1/2" />
      )}
    </div>
  );
};

// Simple user icon SVG component
const UserIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg 
    className={className} 
    fill="currentColor" 
    viewBox="0 0 24 24" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path 
      fillRule="evenodd" 
      d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" 
      clipRule="evenodd" 
    />
  </svg>
);

export default Avatar;