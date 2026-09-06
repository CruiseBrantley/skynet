
import React, { useEffect, useRef } from "react";
import styles from "./ChatContainer.module.css";
import { MessageBubble } from "../MessageBubble/MessageBubble";
import { ThinkingIndicator } from "../ThinkingIndicator/ThinkingIndicator";
import type { ChatMessage } from "../../types";

interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinkingStatus: string | null;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  isStreaming,
  thinkingStatus
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isStreaming, thinkingStatus]);

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={styles.messagesList}>
        {messages.length === 0 && !isStreaming ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🤖</span>
            <p>No messages yet. Send a query to start chatting with Skynet.</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble key={idx + "_" + (msg.timestamp || 0)} message={msg} />
          ))
        )}
        {isStreaming && thinkingStatus && (
          <ThinkingIndicator statusText={thinkingStatus} />
        )}
      </div>
    </div>
  );
};
