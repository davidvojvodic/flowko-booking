import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Component, useEffect } from "react";
import { vi } from "vitest";

import ErrorBoundary from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  test("should render children when no error occurs", () => {
    const { container } = render(
      <ErrorBoundary>
        <div>Child Component</div>
      </ErrorBoundary>
    );

    const childElement = container.querySelector("div");
    expect(childElement).toBeInTheDocument();
    expect(childElement?.textContent).toBe("Child Component");
  });

  test("should render error message and error details when an error occurs", () => {
    const ErrorThrowingComponent = () => {
      useEffect(() => {
        throw new Error("Test Error");
      }, []);

      return <div>Error Throwing Component</div>;
    };

    render(
      <ErrorBoundary message="Error Message">
        <ErrorThrowingComponent />
      </ErrorBoundary>
    );

    const errorMessage = screen.getByText("Error Message");
    const errorDetails = screen.getByText("Error: Test Error");
    expect(errorMessage).toBeInTheDocument();
    expect(errorDetails).toBeInTheDocument();
  });

  test.each([
    "NEXT_HTTP_ERROR_FALLBACK;404",
    "NEXT_HTTP_ERROR_FALLBACK;403",
    "NEXT_NOT_FOUND",
    "NEXT_REDIRECT;replace;/event-types;307;",
  ])("passes Next's %s up to the next boundary instead of showing an error", (digest) => {
    class Outer extends Component<{ children: ReactNode }, { caught: boolean }> {
      state = { caught: false };
      static getDerivedStateFromError() {
        return { caught: true };
      }
      render() {
        return this.state.caught ? <div>Outer boundary</div> : this.props.children;
      }
    }
    const Throwing = () => {
      throw Object.assign(new Error("next"), { digest });
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <Outer>
        <ErrorBoundary message="Error Message">
          <Throwing />
        </ErrorBoundary>
      </Outer>
    );

    expect(screen.getByText("Outer boundary")).toBeInTheDocument();
    expect(screen.queryByText("Error Message")).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});
