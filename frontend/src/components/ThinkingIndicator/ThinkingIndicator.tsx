
import styles from "./ThinkingIndicator.module.css";

interface ThinkingIndicatorProps {
  statusText?: string | null;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ statusText }) => {
  const displayStatus = (statusText || "Skynet is thinking...").replace(/^\*+|\*+$/g, "").trim();

  return (
    <div className={styles.thinkingWrapper}>
      <div className={styles.meta}>Skynet • Thinking...</div>
      <div className={styles.thinkingBubble}>
        <div className={styles.typingIndicator}>
          <div className={styles.typingDot} />
          <div className={styles.typingDot} />
          <div className={styles.typingDot} />
        </div>
        <span className={styles.statusText}>{displayStatus}</span>
      </div>
    </div>
  );
};
