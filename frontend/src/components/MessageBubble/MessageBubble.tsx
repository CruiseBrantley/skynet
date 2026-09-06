
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./MessageBubble.module.css";
import type { ChatMessage } from "../../types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === "user";
  const sourceTag = message.source === "discord"
    ? " [Discord]"
    : message.source === "cli"
    ? " [CLI]"
    : "";

  const timeStr = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const authorLabel = (message.author || (isUser ? "You" : "Skynet")) + sourceTag;

  return (
    <div className={styles.messageWrapper + " " + (isUser ? styles.userMessage : styles.assistantMessage)}>
      <div className={styles.meta}>
        <span>{authorLabel}</span>
        {timeStr && <span>• {timeStr}</span>}
      </div>
      <div className={styles.bubble + " " + (isUser ? styles.userBubble : styles.assistantBubble)}>
        {isUser ? (
          <div>{message.content}</div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
};
