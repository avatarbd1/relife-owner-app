export const Colors = {
  primary: "#1e40af",
  accent: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  semantic: {
    success: "#10b981",
    info: "#3b82f6",
    warning: "#f59e0b",
    error: "#ef4444",
    neutral: "#6b7280",
  },
  slate: {
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
  },
} as const;

export const Spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  "2xl": "32px",
  "3xl": "48px",
} as const;

export const Typography = {
  display: { size: "32px", weight: 700, lineHeight: 1.1 },
  h1: { size: "24px", weight: 700, lineHeight: 1.2 },
  h2: { size: "20px", weight: 600, lineHeight: 1.3 },
  h3: { size: "16px", weight: 600, lineHeight: 1.4 },
  bodyLarge: { size: "16px", weight: 400, lineHeight: 1.5 },
  body: { size: "14px", weight: 400, lineHeight: 1.5 },
  bodySmall: { size: "13px", weight: 400, lineHeight: 1.4 },
  caption: { size: "12px", weight: 400, lineHeight: 1.4 },
  label: { size: "11px", weight: 600, lineHeight: 1.3 },
} as const;

export const ComponentSizing = {
  buttonHeight: "40px",
  inputHeight: "44px",
  cardPadding: "16px",
  cardRadius: "12px",
  modalRadius: "16px",
  avatar: "40px",
  avatarSmall: "32px",
  icon: "20px",
  iconLarge: "24px",
} as const;

export const Shadows = {
  sm: "0 1px 2px 0 rgba(0,0,0,0.05)",
  md: "0 4px 6px -1px rgba(0,0,0,0.1)",
  lg: "0 10px 15px -3px rgba(0,0,0,0.1)",
  xl: "0 20px 25px -5px rgba(0,0,0,0.1)",
} as const;
