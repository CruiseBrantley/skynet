
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "./ChatInput";

describe("ChatInput", () => {
  it("submits message on click and clears textarea", () => {
    const handleSend = vi.fn();
    render(<ChatInput onSend={handleSend} disabled={false} />);
    const textarea = screen.getByPlaceholderText(/Message Skynet/i);
    const sendBtn = screen.getByText("Send");

    fireEvent.change(textarea, { target: { value: "Hello Skynet" } });
    fireEvent.click(sendBtn);

    expect(handleSend).toHaveBeenCalledWith("Hello Skynet");
    expect(textarea).toHaveValue("");
  });

  it("disables send button when disabled prop is true", () => {
    render(<ChatInput onSend={vi.fn()} disabled={true} />);
    const sendBtn = screen.getByText("Send");
    expect(sendBtn).toBeDisabled();
  });
});
