
import React, { useState, useRef } from "react";
import styles from "./ChatInput.module.css";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled }) => {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  };

  return (
    <footer className={styles.footer}>
      <div className={styles.inputContainer}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message Skynet or enter /command..."
          rows={1}
          disabled={disabled}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
        >
          Send
        </button>
      </div>
    </footer>
  );
};
