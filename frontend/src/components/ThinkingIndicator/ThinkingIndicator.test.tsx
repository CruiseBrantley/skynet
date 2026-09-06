
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThinkingIndicator } from "./ThinkingIndicator";

describe("ThinkingIndicator", () => {
  it("renders base status initially", () => {
    render(<ThinkingIndicator statusText="Skynet is thinking..." />);
    expect(screen.getByText("Skynet is thinking...")).toBeInTheDocument();
  });

  it("strips asterisks and renders server-provided status cleanly", () => {
    render(<ThinkingIndicator statusText="*Skynet is thinking... (analyzing query)*" />);
    expect(screen.getByText("Skynet is thinking... (analyzing query)")).toBeInTheDocument();
  });
});
