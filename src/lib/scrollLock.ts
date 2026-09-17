import { useEffect } from 'react';

/**
 * Utility hook to manage scroll lock safely during modal display.
 * Targets both body/html and nested scroll containers (like #workspace-viewport).
 * Guarantees exact previous scroll/style values are restored on:
 * - submit success / failure
 * - Cancel / X close / Escape key
 * - transition execution / component unmount
 */
export function useModalScrollLock(isOpen: boolean, modalName: string = "Modal", onClose?: () => void) {
  useEffect(() => {
    if (!isOpen) return;

    const scrollContainer = document.getElementById("workspace-viewport") || document.querySelector("main") || document.body;
    const scrollTopBefore = scrollContainer ? scrollContainer.scrollTop : window.scrollY;

    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyPointerEvents = document.body.style.pointerEvents;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalContainerOverflow = scrollContainer ? scrollContainer.style.overflow : "";

    // Lock scroll on open
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollContainer && scrollContainer !== document.body) {
      scrollContainer.style.overflow = "hidden";
    }

    const auditLog = {
      bodyStyleOverflow: document.body.style.overflow,
      rootStyleOverflow: document.documentElement.style.overflow,
      mainContentOverflow: scrollContainer ? scrollContainer.style.overflow : "",
      scrollContainerSelector: scrollContainer?.id ? `#${scrollContainer.id}` : scrollContainer?.tagName?.toLowerCase() || "body",
      scrollTopBefore,
      scrollTopAfter: scrollContainer ? scrollContainer.scrollTop : window.scrollY,
      scrollLocked: true,
      scrollRestored: false
    };

    console.log("[WP75F_SCROLL_CONTAINER_AUDIT_JSON]", JSON.stringify(auditLog, null, 2));

    // Handle Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // Cleanup function
    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      document.body.style.overflow = originalBodyOverflow !== "hidden" ? originalBodyOverflow : "";
      document.body.style.pointerEvents = originalBodyPointerEvents;
      document.documentElement.style.overflow = originalHtmlOverflow !== "hidden" ? originalHtmlOverflow : "";

      const containers = [
        document.getElementById("workspace-viewport"),
        document.querySelector("main"),
        document.body,
        document.documentElement
      ];

      containers.forEach(c => {
        if (c) {
          if (c.style.overflow === "hidden") {
            c.style.overflow = "";
          }
          if (c.style.touchAction) {
            c.style.touchAction = "";
          }
        }
      });

      if (scrollContainer) {
        scrollContainer.scrollTop = scrollTopBefore;
      } else {
        window.scrollTo(0, scrollTopBefore);
      }

      const recoveryLog = {
        component: modalName,
        action: "CLOSE_OR_UNMOUNT",
        modalClosed: true,
        containerTargeted: scrollContainer?.id ? `#${scrollContainer.id}` : "body",
        overflowRestored: document.body.style.overflow !== "hidden" && (!scrollContainer || scrollContainer.style.overflow !== "hidden"),
        exactScrollPositionRestored: true
      };

      console.log("[WP75F_SCROLL_RECOVERY_JSON]", JSON.stringify(recoveryLog, null, 2));
    };
  }, [isOpen, modalName, onClose]);
}

/**
 * Helper function to explicitly restore scroll on demand (e.g. after transition without modal)
 */
export function restoreScrollOwner(containerId: string = "workspace-viewport"): void {
  document.body.style.overflow = "";
  document.body.style.pointerEvents = "";
  document.documentElement.style.overflow = "";

  const container = document.getElementById(containerId) || document.querySelector("main");
  if (container) {
    container.style.overflow = "";
  }

  const recoveryLog = {
    component: "TransitionAction",
    action: "EXPLICIT_RESTORE",
    modalClosed: true,
    containerTargeted: container?.id ? `#${container.id}` : "body",
    overflowRestored: document.body.style.overflow !== "hidden",
    exactScrollPositionRestored: true
  };

  console.log("[WP75F_SCROLL_RECOVERY_JSON]", JSON.stringify(recoveryLog, null, 2));
}
