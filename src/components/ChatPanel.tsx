/**
 * This is a mock component for demonstration purposes.
 * In a real implementation, you would have a fully functional chat panel component.
 */
import { useEffect, useState, memo } from 'react';

interface ChatPanelProps {
  gameId: string;
}

function ChatPanel({ gameId }: ChatPanelProps) {
  const [messages, setMessages] = useState<string[]>([]);
  
  useEffect(() => {
    // Log when the component is loaded to demonstrate code splitting
    console.log('ChatPanel component loaded for game:', gameId);
    
    // In a real implementation, this would connect to a chat service
    setMessages(['Welcome to the game chat!', 'Type a message to communicate with other players.']);
    
    // Cleanup on unmount
    return () => {
      console.log('ChatPanel component unloaded');
    };
  }, [gameId]);
  
  const handleSendMessage = () => {
    // Mock implementation
    console.log('Message sent');
  };
  
  return (
    <div className="chat-panel">
      <h2>Chat</h2>
      <div className="messages">
        {messages.map((msg, index) => (
          <div key={index} className="message">
            {msg}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input type="text" placeholder="Type a message..." />
        <button onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(ChatPanel);
