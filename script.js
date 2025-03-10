(function() {
  // URL change detection
  const setupUrlChangeDetection = () => {
    const detectUrlChange = () => {
      let currentUrl = document.location.href;
      const body = document.querySelector("body");
      
      const observer = new MutationObserver(() => {
        if (currentUrl !== document.location.href) {
          currentUrl = document.location.href;
          if (window.top) {
            window.top.postMessage({
              type: "URL_CHANGED", 
              url: document.location.href
            }, "*");
          }
        }
      });
      
      if (body) {
        observer.observe(body, { childList: true, subtree: true });
      }
    };
    
    window.addEventListener("load", detectUrlChange);
  };

  // Constants
  const CONSTANTS = {
    ALLOWED_ORIGINS: ["*"],
    DEBOUNCE_DELAY: 10,
    Z_INDEX: 10000,
    TOOLTIP_OFFSET: 25,
    MAX_TOOLTIP_WIDTH: 200,
    SCROLL_DEBOUNCE: 420
  };

  // Send message to parent window
  const sendMessageToParent = (message) => {
    try {
      if (!window.parent) return;
      if (!message || typeof message !== "object") {
        console.error("Invalid message format");
        return;
      }
      window.parent.postMessage(message, "*");
    } catch (error) {
      console.error(`Failed to send message:`, error);
    }
  };

  // Wait for DOM to be ready
  const waitForDomReady = () => {
    return new Promise(resolve => {
      if (document.readyState !== "loading") {
        resolve();
        return;
      }
      
      document.addEventListener('DOMContentLoaded', () => {
        resolve();
      });
    });
  };

  // Wait for React root to be ready
  const waitForReactRoot = () => {
    return new Promise(resolve => {
      const root = document.getElementById("root") || document.getElementById("__next");
      if (root && root.children.length > 0) {
        resolve();
        return;
      }
      
      new MutationObserver((mutations, observer) => {
        const root = document.getElementById("root") || document.getElementById("__next");
        if (root && root.children.length > 0) {
          observer.disconnect();
          resolve();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  };

  // Intercept network requests
  const interceptNetworkRequests = () => {
    const originalFetch = window.fetch;
    
    window.fetch = async function(...args) {
      const startTime = Date.now();
      
      try {
        let requestBody;
        if (args?.[1]?.body) {
          try {
            if (typeof args[1].body === "string") {
              requestBody = args[1].body;
            } else if (args[1].body instanceof FormData) {
              requestBody = "FormData: " + Array.from(args[1].body.entries()).map(([key, value]) => `${key}=${value}`).join("&");
            } else if (args[1].body instanceof URLSearchParams) {
              requestBody = args[1].body.toString();
            } else {
              requestBody = JSON.stringify(args[1].body);
            }
          } catch {
            requestBody = "Could not serialize request body";
          }
        }
        
        const response = await originalFetch(...args);
        
        let responseText;
        try {
          if (response?.clone) {
            const clonedResponse = response.clone();
            responseText = await clonedResponse.text();
          }
        } catch (e) {
          responseText = "Could not read response body";
        }
        
        sendMessageToParent({
          type: "NETWORK_REQUEST",
          request: {
            url: args?.[0] || response.url,
            method: args?.[1]?.method || "GET",
            status: response.status,
            statusText: response.statusText,
            responseBody: responseText,
            requestBody: requestBody,
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            origin: window.location.origin,
            headers: args?.[1]?.headers ? Object.fromEntries(new Headers(args?.[1]?.headers)) : {}
          }
        });
        
        return response;
      } catch (error) {
        let requestBody;
        if (args?.[1]?.body) {
          try {
            if (typeof args[1].body === "string") {
              requestBody = args[1].body;
            } else if (args[1].body instanceof FormData) {
              requestBody = "FormData: " + Array.from(args[1].body.entries()).map(([key, value]) => `${key}=${value}`).join("&");
            } else if (args[1].body instanceof URLSearchParams) {
              requestBody = args[1].body.toString();
            } else {
              requestBody = JSON.stringify(args[1].body);
            }
          } catch {
            requestBody = "Could not serialize request body";
          }
        }
        
        const requestInfo = {
          url: args?.[0],
          method: args?.[1]?.method || "GET",
          origin: window.location.origin,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          headers: args?.[1]?.headers ? Object.fromEntries(new Headers(args?.[1]?.headers)) : {},
          requestBody: requestBody
        };
        
        const errorInfo = error instanceof TypeError
          ? { ...requestInfo, error: { message: error?.message || "Unknown error", stack: error?.stack } }
          : { ...requestInfo, error: { 
              message: error && typeof error === "object" && "message" in error && typeof error.message === "string" 
                ? error.message 
                : "Unknown fetch error",
              stack: error && typeof error === "object" && "stack" in error && typeof error.stack === "string"
                ? error.stack
                : "Not available"
            }
          };
        
        sendMessageToParent({
          type: "NETWORK_REQUEST",
          request: errorInfo
        });
        
        throw error;
      }
    };
  };

  // Set up error handling
  const setupErrorHandling = (() => {
    let isSetup = false;
    
    return () => {
      if (isSetup) return;
      
      // Set up network request interception
      interceptNetworkRequests();
      
      // Error deduplication
      const recentErrors = new Set();
      const getErrorKey = (error) => {
        const { lineno, colno, filename, message } = error;
        return `${message}|${filename}|${lineno}|${colno}`;
      };
      
      const isDuplicateError = (error) => {
        const key = getErrorKey(error);
        if (recentErrors.has(key)) return true;
        
        recentErrors.add(key);
        setTimeout(() => recentErrors.delete(key), 5000);
        return false;
      };
      
      // Format error for sending
      const formatError = ({ message, lineno, colno, filename, error }) => ({
        message,
        lineno,
        colno,
        filename,
        stack: error?.stack
      });
      
      // Handle runtime errors
      const handleError = (event) => {
        const key = getErrorKey(event);
        if (isDuplicateError(key)) return;
        
        const formattedError = formatError(event);
        sendMessageToParent({
          type: "RUNTIME_ERROR",
          error: formattedError
        });
      };
      
      // Add event listeners
      window.addEventListener("error", handleError);
      
      // Handle unhandled promise rejections
      window.addEventListener("unhandledrejection", (event) => {
        if (!event.reason?.stack) return;
        
        const errorKey = event.reason?.stack || event.reason?.message || String(event.reason);
        if (isDuplicateError(errorKey)) return;
        
        const error = {
          message: event.reason?.message || "Unhandled promise rejection",
          stack: event.reason?.stack || String(event.reason)
        };
        
        sendMessageToParent({
          type: "UNHANDLED_PROMISE_REJECTION",
          error
        });
      });
      
      isSetup = true;
    };
  })();

  // Intercept console methods
  const setupConsoleInterception = (() => {
    let isSetup = false;
    
    return () => {
      if (isSetup) return;
      
      const originalMethods = {
        log: console.log,
        warn: console.warn,
        error: console.error
      };
      
      const levelMap = {
        log: "info",
        warn: "warning",
        error: "error"
      };
      
      const interceptConsoleMethod = (method) => {
        console[method] = function(...args) {
          // Call original method
          originalMethods[method].apply(console, args);
          
          // Get stack trace for warnings and errors
          let stack = null;
          if (method === "warn" || method === "error") {
            const error = new Error();
            if (error.stack) {
              stack = error.stack.split('\n').slice(2).join('\n');
            }
          }
          
          // Format message
          const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          ).join(" ") + (stack ? '\n' + stack : "");
          
          // Send to parent
          sendMessageToParent({
            type: "CONSOLE_OUTPUT",
            level: levelMap[method],
            message: message,
            logged_at: new Date().toISOString()
          });
        };
      };
      
      // Intercept all console methods
      interceptConsoleMethod("log");
      interceptConsoleMethod("warn");
      interceptConsoleMethod("error");
      
      isSetup = true;
    };
  })();

  // Main initialization
  const initialize = () => {
    if (window.location.search.includes("softgen-override-script")) {
      console.log("Overriding script with development version");
      return;
    }
    
    // Only run in iframes
    if (window.top !== window.self) {
      setupUrlChangeDetection();
      setupErrorHandling();
      setupConsoleInterception();
      
      // Send ready message
      waitForDomReady().then(() => {
        sendMessageToParent({
          type: "MONITOR_SCRIPT_LOADED",
          timestamp: new Date().toISOString()
        });
        
        console.log("SoftGen monitoring script loaded");
      });
    }
  };

  // Start the script
  initialize();
})();
