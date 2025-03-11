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
              url: document.location.href,
              path: document.location.pathname
            }, "*");
          }
        }
      });
      
      if (body) {
        observer.observe(body, { childList: true, subtree: true });
      }
    };
    
    window.addEventListener("load", detectUrlChange);
    window.addEventListener("popstate", () => {
      if (window.top) {
        window.top.postMessage({
          type: "URL_CHANGED", 
          url: document.location.href,
          path: document.location.pathname
        }, "*");
      }
    });
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
        
        // Extract path from URL
        let path = null;
        try {
          const url = new URL(args?.[0] || response.url);
          path = url.pathname;
        } catch (e) {
          // If URL parsing fails, leave path as null
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
            headers: args?.[1]?.headers ? Object.fromEntries(new Headers(args?.[1]?.headers)) : {},
            path: path
          }
        });
        
        // For 404 errors, also log to console to ensure capture
        if (response.status === 404) {
          console.error(`GET ${args?.[0] || response.url} 404 (Not Found)`);
        }
        
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
        
        // Extract path from URL
        let path = null;
        try {
          const url = new URL(args?.[0]);
          path = url.pathname;
        } catch (e) {
          // If URL parsing fails, leave path as null
        }
        
        const requestInfo = {
          url: args?.[0],
          method: args?.[1]?.method || "GET",
          origin: window.location.origin,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          headers: args?.[1]?.headers ? Object.fromEntries(new Headers(args?.[1]?.headers)) : {},
          requestBody: requestBody,
          path: path
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
    
    // Intercept XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._softgenMonitorData = {
        method,
        url,
        startTime: null
      };
      return originalXHROpen.apply(this, [method, url, ...rest]);
    };
    
    XMLHttpRequest.prototype.send = function(body) {
      if (this._softgenMonitorData) {
        this._softgenMonitorData.startTime = Date.now();
        this._softgenMonitorData.requestBody = body;
        
        // Add load event listener
        this.addEventListener('load', function() {
          const duration = Date.now() - this._softgenMonitorData.startTime;
          
          // Extract path from URL
          let path = null;
          try {
            const url = new URL(this._softgenMonitorData.url, window.location.origin);
            path = url.pathname;
          } catch (e) {
            // If URL parsing fails, leave path as null
          }
          
          sendMessageToParent({
            type: "NETWORK_REQUEST",
            request: {
              url: this._softgenMonitorData.url,
              method: this._softgenMonitorData.method,
              status: this.status,
              statusText: this.statusText,
              responseBody: this.responseText,
              requestBody: this._softgenMonitorData.requestBody,
              timestamp: new Date().toISOString(),
              duration: duration,
              origin: window.location.origin,
              path: path
            }
          });
          
          // For 404 errors, also log to console to ensure capture
          if (this.status === 404) {
            console.error(`${this._softgenMonitorData.method} ${this._softgenMonitorData.url} 404 (Not Found)`);
          }
        });
        
        // Add error event listener
        this.addEventListener('error', function() {
          const duration = Date.now() - this._softgenMonitorData.startTime;
          
          // Extract path from URL
          let path = null;
          try {
            const url = new URL(this._softgenMonitorData.url, window.location.origin);
            path = url.pathname;
          } catch (e) {
            // If URL parsing fails, leave path as null
          }
          
          sendMessageToParent({
            type: "NETWORK_REQUEST",
            request: {
              url: this._softgenMonitorData.url,
              method: this._softgenMonitorData.method,
              status: 0,
              statusText: "Network Error",
              requestBody: this._softgenMonitorData.requestBody,
              timestamp: new Date().toISOString(),
              duration: duration,
              origin: window.location.origin,
              error: { message: "Network request failed" },
              path: path
            }
          });
        });
      }
      
      return originalXHRSend.apply(this, arguments);
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
        
        // Check if this is a 404 error
        let path = null;
        if (event.message && typeof event.message === 'string') {
          // Look for different patterns of 404 errors
          const notFoundMatch = event.message.match(/GET\s+(https?:\/\/[^\s]+)\s+404\s+\(Not\s+Found\)/i);
          if (notFoundMatch && notFoundMatch[1]) {
            try {
              const url = new URL(notFoundMatch[1]);
              path = url.pathname;
              console.log("Extracted path from 404 error:", path);
            } catch (e) {
              console.warn("Failed to parse URL from 404 error");
            }
          }
          
          // Also check for script loading errors
          const scriptErrorMatch = event.message.match(/Failed\s+to\s+load\s+script:\s+([^\s]+)/i);
          if (scriptErrorMatch && scriptErrorMatch[1]) {
            path = scriptErrorMatch[1];
            console.log("Extracted path from script loading error:", path);
          }
          
          // Check for resource loading errors
          const resourceErrorMatch = event.message.match(/Failed\s+to\s+load\s+resource:/i);
          if (resourceErrorMatch && event.filename) {
            try {
              const url = new URL(event.filename);
              path = url.pathname;
              console.log("Extracted path from resource loading error:", path);
            } catch (e) {
              console.warn("Failed to parse URL from resource error");
            }
          }
        }
        
        sendMessageToParent({
          type: "RUNTIME_ERROR",
          error: {
            ...formattedError,
            path: path
          }
        });
      };
      
      // Add event listeners
      window.addEventListener("error", handleError, true); // Use capture phase
      
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
      
      // Capture resource loading errors (404s, etc.)
      const captureResourceErrors = () => {
        // Create a new observer instance
        if (typeof PerformanceObserver !== 'undefined') {
          const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
              // Check for resource loading failures
              if (entry.entryType === 'resource' && !entry.transferSize) {
                const url = entry.name;
                
                // Skip some common noise
                if (url.includes('favicon.ico') || 
                    url.includes('webpack-hmr') ||
                    url.includes('hot-update.json')) {
                  return;
                }
                
                try {
                  const urlObj = new URL(url);
                  const path = urlObj.pathname;
                  
                  sendMessageToParent({
                    type: "NETWORK_REQUEST",
                    request: {
                      url: url,
                      method: "GET",
                      status: 404, // Assume 404 for failed resources
                      statusText: "Not Found",
                      timestamp: new Date().toISOString(),
                      path: path,
                      origin: window.location.origin,
                      error: { message: `Failed to load resource: ${path}` }
                    }
                  });
                  
                  // Also log to console to ensure it's captured by console interception
                  console.error(`Failed to load resource: ${url} (404 Not Found)`);
                } catch (e) {
                  console.warn("Failed to process resource error:", e);
                }
              }
            });
          });

          // Start observing resource timing entries
          observer.observe({ entryTypes: ['resource'] });
        }
      };
      
      // Call the function to capture resource errors
      captureResourceErrors();
      
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
          
          // Extract path from 404 errors in console messages
          let path = null;
          if (method === "error" && typeof args[0] === 'string') {
            // Look for different patterns of 404 errors
            const notFoundMatch = args[0].match(/GET\s+(https?:\/\/[^\s]+)\s+404\s+\(Not\s+Found\)/i);
            if (notFoundMatch && notFoundMatch[1]) {
              try {
                const url = new URL(notFoundMatch[1]);
                path = url.pathname;
              } catch (e) {
                // If URL parsing fails, leave path as null
              }
            }
            
            // Check for script loading errors
            const scriptErrorMatch = args[0].match(/Failed\s+to\s+load\s+script:\s+([^\s]+)/i);
            if (scriptErrorMatch && scriptErrorMatch[1]) {
              path = scriptErrorMatch[1];
            }
            
            // Check for resource loading errors
            const resourceErrorMatch = args[0].match(/Failed\s+to\s+load\s+resource:/i);
            if (resourceErrorMatch && args.length > 1 && typeof args[1] === 'string') {
              try {
                const url = new URL(args[1]);
                path = url.pathname;
              } catch (e) {
                // If URL parsing fails, leave path as null
              }
            }
          }
          
          // Send to parent
          sendMessageToParent({
            type: "CONSOLE_OUTPUT",
            level: levelMap[method],
            message: message,
            logged_at: new Date().toISOString(),
            path: path
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
          timestamp: new Date().toISOString(),
          path: document.location.pathname
        });
        
        console.log("SoftGen monitoring script loaded");
      });
    }
  };

  // Start the script
  initialize();
})();
