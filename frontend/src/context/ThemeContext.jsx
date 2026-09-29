/**
 * ThemeContext.jsx - Studio theme provider (Locked to Light Mode)
 */

import { createContext, useContext, useEffect } from "react";

const ThemeContext = createContext({
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  useEffect(() => {
    // Force light mode regardless of OS preference
    localStorage.setItem("mom_theme", "light");
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.style.colorScheme = "light";
    document.documentElement.style.background = "#F0F6FC";
    document.documentElement.style.color = "#0F172A";
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: "light", setTheme: () => {}, toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
